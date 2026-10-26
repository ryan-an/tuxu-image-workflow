import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { exportSheetTemplate } from "../../../src/integrations/sheet-template.js";
import { ROLES } from "../../../shared/model.js";

test("exported template contains one example row without prompt/result rows or merged metadata", async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportSheetTemplate());
  assert.deepEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    ["产品模板", "填写说明"],
  );
  const sheet = workbook.getWorksheet("产品模板")!;
  assert.equal(sheet.getCell("A2").value, "示例-001");
  assert.match(String(sheet.getCell("C2").value), /陶瓷餐盘.*\n品牌/);
  assert.equal(sheet.rowCount, 2);
  assert.equal(sheet.getCell("D2").value, "示例图");
  assert.equal(sheet.model.merges?.length || 0, 0);
  assert.deepEqual(
    ROLES.map((_, index) => sheet.getCell(1, index + 5).value),
    ROLES,
  );
  assert.equal(sheet.getCell(1, ROLES.length + 5).value, "实拍图1");
  assert.equal(sheet.getCell(1, ROLES.length + 10).value, "实拍图6");
  assert.equal(sheet.views[0].state, "frozen");
  assert.match(
    String(workbook.getWorksheet("填写说明")!.getCell("B6").value),
    /无需填写/,
  );
});
