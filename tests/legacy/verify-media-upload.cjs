const { artifactPath } = require("../support/artifacts.cjs");
const { chromium } = require('C:/Users/root/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForFunction(() => window.workflow);
    const fixtures = await page.evaluate(() => {
      const images = ['#b94148', '#617e58', '#486c96', '#b78c43', '#685ba1', '#5b8c8d'].map((color, i) => {
        const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 300;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f4f1e9'; ctx.fillRect(0, 0, 400, 300);
        ctx.fillStyle = color; ctx.fillRect(80 + i * 3, 60, 240 - i * 5, 180);
        ctx.strokeStyle = '#ffffff60'; ctx.lineWidth = 3; ctx.strokeRect(90 + i * 3, 70, 220 - i * 5, 160);
        return canvas.toDataURL('image/png');
      });
      const [first, second] = workflow.state.products;
      first.photo = ''; first.photos = []; first.tasks[0].references = []; first.tasks[1].references = [];
      return { images, first: first.id, second: second.id, secondPhoto: second.photo, t0: first.tasks[0].id, t1: first.tasks[1].id };
    });
    await page.evaluate(() => workflow.switchView('workbench'));
    async function transfer(selector, { images = [], html = '', text = '', drop = false, bad = false } = {}) {
      await page.evaluate(async ({ selector, images, html, text, drop, bad }) => {
        const data = new DataTransfer();
        for (const [index, source] of images.entries()) {
          const blob = await (await fetch(source)).blob(); data.items.add(new File([blob], `paste-${index}.png`, { type: 'image/png' }));
        }
        if (bad) data.items.add(new File(['not an image'], 'broken.png', { type: 'image/png' }));
        if (html) data.setData('text/html', html);
        if (text) data.setData('text/plain', text);
        document.querySelector(selector).dispatchEvent(drop
          ? new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true })
          : new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      }, { selector, images, html, text, drop, bad });
    }
    await page.locator('[data-action=upload-photo]').click();
    assert.equal(await page.locator('#media-dropzone').evaluate(el => el === document.activeElement), true);
    await transfer('#media-dropzone', { images: fixtures.images.slice(0, 2), html: `<img src="${fixtures.images[0]}">` });
    await page.waitForFunction(() => document.querySelector('#media-feedback').textContent.includes('已添加 2'));
    assert.equal(await page.locator('.media-gallery img').count(), 2);
    assert.equal(await page.evaluate(() => workflow.state.products[0].photos.length), 2);
    assert.equal(await page.evaluate(() => workflow.state.products[0].tasks[0].references.length), 0);
    assert.equal(await page.evaluate(() => Object.values(workflow.bridge.snapshot().sheets.preview.cellData[1][3].p.drawings)[0].source), fixtures.images[0]);
    await transfer('#media-dropzone', { images: [fixtures.images[0]] });
    await page.waitForFunction(() => document.querySelector('#media-feedback').textContent.includes('已跳过重复'));
    assert.equal(await page.locator('.media-gallery img').count(), 2);
    await transfer('#media-dropzone', { bad: true });
    await page.waitForFunction(() => document.querySelector('#media-feedback').textContent.includes('无法打开'));
    assert.equal(await page.locator('.media-gallery img').count(), 2);
    await transfer('#media-dropzone', { images: [fixtures.images[2]] });
    await page.waitForFunction(() => workflow.state.products[0].photos.length === 3);
    await page.locator('#media-dropzone').click();
    await page.locator('#image-input').setInputFiles([3, 1].map(i => ({ name: `photo-${i}.png`, mimeType: 'image/png', buffer: Buffer.from(fixtures.images[i].split(',')[1], 'base64') })));
    await page.waitForFunction(() => document.querySelector('#media-feedback').textContent.includes('重复图片已跳过'));
    assert.equal(await page.evaluate(() => workflow.state.products[0].photos.length), 4);
    await page.screenshot({ path: artifactPath("media-upload-preview.png") });
    await page.locator('#modal [data-action=close-modal]').last().click();
    // Direct drop on a card opens the right reference destination.
    await transfer(`.task-card[data-task="${fixtures.t0}"] .reference`, { images: [fixtures.images[4]], drop: true });
    await page.waitForFunction(() => workflow.state.products[0].tasks[0].references.length === 1);
    assert.ok((await page.locator('#media-uploader h2').textContent()).includes('尺寸图'));
    assert.equal(await page.evaluate(() => workflow.state.products[0].photos.length), 4);
    assert.equal(await page.evaluate(() => Object.values(workflow.bridge.snapshot().sheets.preview.cellData[1][4].p.drawings)[0].source), fixtures.images[4]);
    // Multi-cell Shimo HTML pastes into this position, with no extra copy of binary image payloads.
    let release;
    await page.route('**/api/shimo-image', async route => {
      const url = route.request().postDataJSON().url;
      if (url.includes('slow')) await new Promise(resolve => { release = resolve; });
      if (url.includes('expired')) return route.fulfill({ status: 403, json: { error: 'expired' } });
      const index = url.includes('/b.png') ? 1 : url.includes('/c.png') ? 2 : 0;
      await route.fulfill({ contentType: 'image/png', body: Buffer.from(fixtures.images[index].split(',')[1], 'base64') });
    });
    await transfer('#media-dropzone', { html: '<table><tr><td><img src="https://uploader.shimo.im/f/a.png"></td><td><img src="https://uploader.shimo.im/f/b.png"></td><td><a href="https://uploader.shimo.im/f/c.png">image</a></td></tr></table>' });
    await page.waitForFunction(() => workflow.state.products[0].tasks[0].references.length === 4);
    await transfer('#media-dropzone', { text: 'https://uploader.shimo.im/f/expired.png' });
    await page.waitForFunction(() => document.querySelector('#media-feedback').textContent.includes('已失效'));
    assert.equal(await page.evaluate(() => workflow.state.products[0].tasks[0].references.length), 4);
    // Changing destinations while a network image is loading must not redirect that image.
    await page.locator('#modal [data-action=close-modal]').last().click();
    await page.locator(`.reference[data-task="${fixtures.t1}"]`).click();
    await transfer('#media-dropzone', { text: 'https://uploader.shimo.im/f/slow.png' });
    while (!release) await new Promise(resolve => setTimeout(resolve, 20));
    await page.locator('#modal [data-action=close-modal]').last().click();
    await page.locator(`[data-action=open-product][data-id="${fixtures.second}"]`).click();
    await page.locator('[data-action=upload-photo]').click();
    release();
    await page.waitForFunction(() => workflow.state.products[0].tasks[1].references.length === 1);
    assert.equal(await page.evaluate(() => workflow.state.products[1].photo), fixtures.secondPhoto);
    assert.equal(await page.locator('#media-uploader h2').textContent(), '产品实拍图');
    await page.locator('#modal [data-action=close-modal]').last().click();
    await page.locator(`[data-action=open-product][data-id="${fixtures.first}"]`).click();
    await page.locator('[data-action=upload-photo]').click();
    while (await page.locator('[data-action=remove-photo]').count())
      await page.locator('[data-action=remove-photo]').first().click();
    await page.locator('#media-dropzone').click();
    await page.locator('#image-input').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: Buffer.from(fixtures.images[5].split(',')[1], 'base64') });
    await page.waitForFunction(() => document.querySelector('#media-feedback').textContent.includes('已添加'));
    assert.equal(await page.locator('.media-gallery img').count(), 1);
    assert.equal(await page.evaluate(() => workflow.state.products[0].photo), fixtures.images[5]);
    await page.locator('[data-action=remove-photo]').click();
    assert.equal(await page.locator('.media-gallery img').count(), 0);
    await transfer('#media-dropzone', { images: [fixtures.images[5]] });
    await page.waitForFunction(() => workflow.state.products[0].photos.length === 1);
    await page.locator('#modal [data-action=close-modal]').last().click();
    await page.locator(`[data-action=edit-prompt][data-task="${fixtures.t0}"]`).click();
    const prevented = await page.evaluate(() => {
      const data = new DataTransfer(); data.setData('text/plain', 'normal prompt text');
      return !document.querySelector('#prompt-form textarea').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    assert.equal(prevented, false, 'Text editor paste remains untouched');
    await page.locator('#modal [data-action=close-modal]').first().click();
    await page.evaluate(() => workflow.persist());
    await page.reload(); await page.waitForFunction(() => window.workflow);
    const saved = await page.evaluate(() => ({ photos: workflow.state.products[0].photos.length, refs: workflow.state.products[0].tasks.slice(0, 2).map(t => t.references.length), jobs: workflow.state.jobs.length }));
    assert.deepEqual(saved, { photos: 1, refs: [4, 1], jobs: 0 });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ pasteFiles: true, deduplicate: true, clickToUpload: true, append: true, shimoImageGroup: true, directDrop: true, invalidKeepsExisting: true, destinationCaptured: true, tableBackfill: true, textPasteUnaffected: true, reload: true }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
