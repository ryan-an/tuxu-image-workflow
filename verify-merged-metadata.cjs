const { chromium } = require('C:/Users/root/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForFunction(() => window.workflow);
    // Simulate an existing saved preview with repeated metadata in all three rows.
    await page.evaluate(async () => {
      const { workflowSnapshot } = await import('/src/sheet-bridge.js');
      const snapshot = workflowSnapshot(workflow.state);
      const sheet = snapshot.sheets.preview;
      sheet.mergeData = [];
      workflow.state.products.forEach((product, i) => {
        for (const r of [1 + i * 3, 2 + i * 3, 3 + i * 3]) {
          sheet.cellData[r][0].v = product.code;
          sheet.cellData[r][1].v = `${product.name}\n${product.facts}`;
        }
      });
      workflow.state.sheetSnapshot = snapshot;
      delete workflow.state.sheetMetadataMergeVersion;
      await workflow.persist();
    });
    await page.reload();
    await page.waitForFunction(() => window.workflow);
    assert.equal(await page.evaluate(() => workflow.state.sheetSnapshot.sheets.preview.mergeData.length), 60);
    await page.locator('[data-action="view"][data-view="sheet"]').click();
    await page.waitForFunction(() => workflow.bridge.workbook);
    await page.locator('#sheet-container canvas').first().waitFor({ state: 'visible' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'merged-metadata-preview.png' });
    const checks = await page.evaluate(async () => {
      const { detectColumns, parseSheet, imageCell } = await import('/src/sheet-bridge.js');
      const { newProduct } = await import('/src/model.js');
      const bridge = workflow.bridge, product = workflow.state.products[0], task = product.tasks[0];
      const sheet = bridge.snapshot().sheets.preview;
      const parsed = parseSheet(sheet, detectColumns(sheet));
      const before = { count: parsed.length, code: parsed[0].code, name: parsed[0].name, facts: parsed[0].facts,
        childCode: sheet.cellData[2][0].v, childMetadata: sheet.cellData[3][1].v };
      const added = newProduct('合并-001', '新增合并产品', '31个装\n宽24cm');
      workflow.state.products.push(added);
      bridge.appendProduct(added);
      const appended = bridge.snapshot().sheets.preview.mergeData.filter(m => m.startRow === 91).length;
      const target = bridge.workbook.getSheetBySheetId('preview');
      // Shift both the header and metadata merges; bindings must resolve the merged code.
      target.insertRows(0, 1);
      target.insertColumns(0, 1);
      task.prompt = '合并后的提示词回填检查';
      await bridge.sync(product, task, 'prompt');
      await bridge.sync(product, task, 'result');
      const location = bridge.locate(product, task, 'prompt');
      const resultLocation = bridge.locate(product, task, 'result');
      const current = bridge.snapshot().sheets.preview;
      const after = parseSheet(current, detectColumns(current));
      const inbox = bridge.workbook.getSheetBySheetId('inbox');
      inbox.getRange(1, 0).setValue(imageCell(product.photo));
      // Check newly generated snapshot layout independently of saved-sheet migration.
      const { workflowSnapshot } = await import('/src/sheet-bridge.js');
      const fresh = workflowSnapshot({ ...workflow.state, products: [product] }).sheets.preview;
      return { before, expected: {code: product.code, name: product.name, facts: product.facts}, appended,
        afterCount: after.length, newProductFacts: after.at(-1).facts,
        prompt: current.cellData[location.row][location.column].v,
        result: Object.values(current.cellData[resultLocation.row][resultLocation.column].p.drawings)[0].source === task.versions.find(v => v.id === task.primaryId).source,
        freshMerges: fresh.mergeData.length, currentMerges: current.mergeData.length };
    });
    assert.equal(checks.before.count, 30);
    assert.equal(checks.before.code, checks.expected.code);
    assert.equal(checks.before.name, checks.expected.name);
    assert.equal(checks.before.facts, checks.expected.facts);
    assert.equal(checks.before.childCode, '');
    assert.equal(checks.before.childMetadata, '');
    assert.equal(checks.appended, 2);
    assert.equal(checks.afterCount, 31);
    assert.equal(checks.newProductFacts, '31个装\n宽24cm');
    assert.equal(checks.prompt, '合并后的提示词回填检查');
    assert.equal(checks.result, true);
    assert.equal(checks.freshMerges, 2);
    assert.equal(checks.currentMerges, 62);
    const download = page.waitForEvent('download');
    await page.locator('[data-action="export-excel"]').click();
    await (await download).saveAs('merged-metadata-check.xlsx');
    const excel = new ExcelJS.Workbook();
    await excel.xlsx.readFile('merged-metadata-check.xlsx');
    const exported = excel.getWorksheet('工作流预览');
    assert.equal(exported.model.merges.length, 62);
    assert.equal(exported.getCell('B3').value, checks.expected.code);
    assert.equal(exported.getCell('B4').value, checks.expected.code);
    assert.equal(exported.getCell('B5').value, checks.expected.code);
    await page.evaluate(() => workflow.persist());
    await page.reload();
    await page.waitForFunction(() => window.workflow);
    assert.equal(await page.evaluate(() => workflow.state.sheetSnapshot.sheets.preview.mergeData.length), 62);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ migratedProducts: 30, mergedMetadata: true, appendProduct: true, parseMergedRows: true,
      rowColumnInsertionBackfill: true, excelMerges: 62, reloadPreserves: true, errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
