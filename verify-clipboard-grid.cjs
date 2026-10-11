const { chromium } = require('C:/Users/root/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForFunction(() => window.workflow);
    await page.locator('[data-action="view"][data-view="sheet"]').click();
    await page.waitForFunction(() => workflow.bridge.workbook);
    const result = await page.evaluate(async () => {
      const { readClipboardImages } = await import('/src/paste-images.js');
      const source = workflow.state.products[0].photo;
      const html = `<table><tr><td rowspan="3">合并编号</td><td rowspan="3">产品名称</td><td>示例图</td><td><img src="${source}"></td><td></td><td><img src="${source}"></td></tr><tr><td>提示词</td><td>尺寸提示</td><td></td><td>细节提示</td></tr><tr><td>结果图</td><td><img src="${source}"></td><td></td><td></td></tr></table>`;
      const positions = readClipboardImages(html, '').map(({ row, column }) => [row, column]);
      const url = 'https://uploader.shimo.im/f/test.png?accessToken=fixture';
      const tsv = readClipboardImages('', `编号\t产品\t${url}\t\t${url}\n\t\t\t\t\n第二套\t名称\t\t${url}`).map(({ row, column }) => [row, column]);
      const markdown = readClipboardImages('', `| 编号 | [image](${url}) | | [image](${url}) |\n| --- | --- | --- | --- |\n| 第二套 | | [image](${url}) | |`).map(({ row, column }) => [row, column]);
      const wb = workflow.bridge.workbook;
      const sheet = wb.getSheetBySheetId('inbox');
      wb.setActiveSheet(sheet);
      sheet.getRange('B2').activate();
      sheet.getRange('F3').setValue('必须清掉的旧内容');
      const clip = new DataTransfer();
      clip.setData('text/html', html);
      await workflow.bridge.paste(clip);
      const cells = workflow.bridge.snapshot().sheets.inbox.cellData;
      const imageAt = (r, c) => Object.values(cells[r]?.[c]?.p?.drawings || {})[0]?.source === source;
      return { positions, tsv, markdown, imagePositions: [[1,4],[1,6],[3,4]].map(([r,c])=>imageAt(r,c)), prompt: cells[2][4].v, role: cells[2][3].v, blank: cells[2][5].v };
    });
    assert.deepEqual(result.positions, [[0,3],[0,5],[2,3]]);
    assert.deepEqual(result.tsv, [[0,2],[0,4],[2,3]]);
    assert.deepEqual(result.markdown, [[0,1],[0,3],[1,2]]);
    assert.deepEqual(result.imagePositions, [true,true,true]);
    assert.equal(result.prompt, '尺寸提示');
    assert.equal(result.role, '提示词');
    assert.equal(result.blank, '');
    console.log(JSON.stringify({ mergedCells: true, emptyColumns: true, emptyRows: true, markdownTable: true, nativeImages: true }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
