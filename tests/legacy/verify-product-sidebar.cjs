const { artifactPath } = require("../support/artifacts.cjs");
const { chromium } = require('C:/Users/root/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.thumbnailEncodes = 0;
      const original = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(...args) {
        if (args[0] === 'image/webp') window.thumbnailEncodes++;
        return original.apply(this, args);
      };
    });
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForFunction(() => window.workflow && workflow.state.products.filter(p => p.photo).every(p => p.photoThumbnail));
    assert.equal(await page.locator('[data-action=select-product]').count(), 0);
    assert.equal(await page.locator('.product-thumbnail img').count(), 2);
    assert.equal(await page.locator('.product-thumbnail .thumbnail-placeholder').count(), 28);
    await page.evaluate(() => {
      const sources = workflow.state.products.slice(0, 2).map(p => p.photo);
      for (const [i, product] of workflow.state.products.entries()) product.photo ||= sources[i % 2];
    });
    await page.locator('[data-action=view][data-view=workbench]').click();
    await page.waitForFunction(() => workflow.state.products.every(p => p.photoThumbnail));
    assert.equal(await page.locator('.product-thumbnail img').count(), 30);
    const ids = await page.evaluate(() => workflow.state.products.slice(0, 3).map(p => p.id));
    await page.locator(`[data-action=open-product][data-id="${ids[1]}"]`).click();
    assert.equal(await page.evaluate(() => workflow.state.activeProductId), ids[1]);
    assert.equal(await page.locator('[data-action=toggle-batch-selection]').count(), 0);
    assert.equal(await page.locator('[data-action=select-task]').count(), 0);
    assert.ok((await page.locator('#batch-label').textContent()).includes('当前产品'));
    await page.locator(`[data-action=open-product][data-id="${ids[0]}"]`).click();
    const original = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1024; canvas.height = 768;
      const ctx = canvas.getContext('2d'), image = ctx.createImageData(canvas.width, canvas.height);
      let seed = 100;
      for (let i = 0; i < image.data.length; i += 4) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        image.data[i] = seed & 255; image.data[i + 1] = (seed >>> 8) & 255;
        image.data[i + 2] = (seed >>> 16) & 255; image.data[i + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
      return canvas.toDataURL('image/png');
    });
    const previousHash = await page.evaluate(() => workflow.state.products[0].photoThumbnail.sourceHash);
    await page.locator('[data-action=upload-photo]').click();
    await page.locator('[data-action=choose-image-files][data-replace=true]').click();
    await page.locator('#image-input').setInputFiles({ name: 'large-real-photo.png', mimeType: 'image/png', buffer: Buffer.from(original.split(',')[1], 'base64') });
    await page.waitForFunction(hash => workflow.state.products[0].photoThumbnail?.sourceHash !== hash && workflow.state.products[0].photoThumbnail?.data, previousHash);
    const compressed = await page.evaluate(async original => {
      const product = workflow.state.products[0], thumbnail = product.photoThumbnail;
      const image = new Image(); image.src = thumbnail.data; await image.decode();
      const sidebar = [...document.querySelectorAll('.product-thumbnail img')];
      const queue = [...document.querySelectorAll('.queue-product-thumbnail img')];
      return { width: image.naturalWidth, height: image.naturalHeight,
        bytes: Math.ceil(thumbnail.data.split(',')[1].length * 3 / 4), originalBytes: Math.ceil(original.split(',')[1].length * 3 / 4),
        originalPreserved: product.photo === original,
        sidebarCompressed: sidebar.every(img => img.src.startsWith('data:image/webp;')),
        queueCompressed: queue.every(img => img.src.startsWith('data:image/webp;')) };
    }, original);
    assert.ok(compressed.width <= 96 && compressed.height <= 96);
    assert.ok(compressed.bytes <= 12 * 1024);
    assert.ok(compressed.bytes < compressed.originalBytes / 100);
    assert.equal(compressed.originalPreserved, true);
    assert.equal(compressed.sidebarCompressed, true);
    assert.equal(compressed.queueCompressed, true);
    await page.locator('#modal [data-action=close-modal]').last().click();
    await page.screenshot({ path: artifactPath("product-sidebar-preview.png") });
    await page.evaluate(() => workflow.persist());
    await page.reload();
    await page.waitForFunction(() => window.workflow && workflow.state.products.every(p => p.photoThumbnail));
    await page.waitForFunction(() => document.querySelector('#save-status').textContent === '已保存到本机');
    assert.equal(await page.evaluate(() => window.thumbnailEncodes), 0);
    assert.equal(await page.locator('[data-action=select-product]').count(), 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ defaultCheckboxes: 0, noProductOrPositionSelection: true, compressed, cachedWithoutReencoding: true, errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
