const { chromium } = require('C:/Users/root/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.demoImport && !document.querySelector('#save').disabled);
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 40;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f08040'; ctx.fillRect(0, 0, 40, 40);
    return canvas.toDataURL().split(',')[1];
  });
  await page.route('**/api/shimo-image', route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(png, 'base64') }));
  const parsed = await page.evaluate(() => {
    const urls = ['https://uploader.shimo.im/f/one.png?accessToken=test', 'https://uploader.shimo.im/f/two.png?accessToken=test', 'https://uploader.shimo.im/f/three.png?accessToken=test'];
    const html = `<table><tr>${urls.map(url => `<td><img src="${url}"></td>`).join('')}</tr></table>`;
    const markdown = '| ' + urls.map(url => `[image](${url})`).join(' | ') + ' |';
    const htmlParsed = window.demoImport.readClipboardImages(html, '');
    const markdownParsed = window.demoImport.readClipboardImages('', markdown);
    const sheet = window.demoAPI.getActiveWorkbook().getActiveSheet();
    sheet.getRange('D8').activate();
    const data = new DataTransfer(); data.setData('text/html', html); data.setData('text/plain', markdown);
    document.querySelector('#sheet-container').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    return { htmlParsed, markdownParsed };
  });
  await page.waitForFunction(() => document.querySelector('#save-status').textContent.startsWith('已导入 3 张'));
  await page.click('#save');
  await page.waitForFunction(() => document.querySelector('#save-status').textContent.startsWith('已保存到本机浏览器'));
  await page.reload();
  await page.waitForFunction(() => window.demoImport && !document.querySelector('#save').disabled);
  const persisted = await page.evaluate(() => {
    const cells = window.demoAPI.getActiveWorkbook().save().sheets.references.cellData[7];
    return [3,4,5].map(column => !!cells?.[column]?.p?.drawings);
  });
  if (JSON.stringify(persisted) !== '[true,true,true]' || errors.length || parsed.htmlParsed.length !== 3 || parsed.markdownParsed.length !== 3) throw new Error(JSON.stringify({ parsed, persisted, errors }));
  const relay = await page.request.post('http://127.0.0.1:5173/api/shimo-image', { data: { url: 'https://example.com/image.png' } });
  if (relay.status() !== 400) throw new Error('Unexpected relay response: ' + relay.status());
  console.log(JSON.stringify({ htmlImages: parsed.htmlParsed.length, markdownImages: parsed.markdownParsed.length, persisted, relayRejectsOtherHost: relay.status(), errors }));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
