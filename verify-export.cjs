const { chromium } = require('C:/Users/root/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const ExcelJS = require('exceljs');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.demoAPI && !document.querySelector('#save').disabled);
  await page.evaluate(() => {
    const sheet = window.demoAPI.getActiveWorkbook().getSheetBySheetId('overview');
    sheet.getRange('Q2').setValue(42);
    sheet.getRange('Q3').setFormula('=Q2*2');
  });
  const downloaded = page.waitForEvent('download');
  await page.click('#export');
  const download = await downloaded;
  const file = path.join(__dirname, 'export-check.xlsx');
  await download.saveAs(file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const overview = wb.getWorksheet('产品总览');
  const references = wb.getWorksheet('参考图示例');
  const images = references.getImages();
  const checks = {
    sheets: wb.worksheets.length,
    productId: overview.getCell('A2').value,
    product30: overview.getCell('A31').value,
    editedValue: overview.getCell('Q2').value,
    formula: overview.getCell('Q3').value.formula,
    images: images.length,
    firstImageColumn: images[0].range.tl.nativeCol,
    firstImageRow: images[0].range.tl.nativeRow,
    headerColor: references.getCell('A1').fill.fgColor.argb,
    rowHeight: references.getRow(2).height,
    errors,
  };
  if (checks.sheets !== 2 || checks.productId !== '26-1732' || checks.editedValue !== 42 || checks.formula !== 'Q2*2' || checks.images !== 22 || checks.firstImageColumn !== 2 || checks.firstImageRow !== 1 || checks.headerColor !== 'FF5B61D6' || checks.rowHeight !== 93 || errors.length) throw new Error(JSON.stringify(checks));
  console.log(JSON.stringify(checks));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
