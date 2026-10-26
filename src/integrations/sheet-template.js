import { ROLES } from "../../shared/model.js";

// A public, self-contained example. Never include the current workspace here.
export async function exportSheetTemplate() {
  const module = await import("exceljs");
  const ExcelJS = module.default || module;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "图序";
  const sheet = workbook.addWorksheet("产品模板");
  const headers = [
    "产品编号",
    "状态",
    "产品名称 / 资料",
    "内容",
    ...ROLES,
    ...Array.from({ length: 6 }, (_, i) => `实拍图${i + 1}`),
  ];
  sheet.addRow(headers);
  sheet.addRow([
    "示例-001",
    "新建产品",
    "示例陶瓷餐盘\n品牌：示例品牌；数量：2个；颜色：白色；外尺寸：37×12cm",
    "示例图",
    ...ROLES.map((role) => `在此放入${role}对标图片`),
    ...Array.from({ length: 6 }, (_, i) => `在此放入实拍图${i + 1}`),
  ]);
  sheet.views = [{ state: "frozen", xSplit: 4, ySplit: 1 }];
  sheet.getRow(1).height = 30;
  sheet.getRow(2).height = 120;
  for (let c = 1; c <= headers.length; c++) {
    sheet.getColumn(c).width = c === 3 ? 36 : c === 1 ? 18 : c <= 4 ? 14 : 25;
    for (let r = 1; r <= 2; r++) {
      const cell = sheet.getCell(r, c);
      cell.font = {
        name: "Microsoft YaHei",
        size: 11,
        ...(r === 1 ? { bold: true, color: { argb: "FFFFFFFF" } } : {}),
      };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: {
          argb: r === 1 ? "FF545DD6" : r === 3 ? "FFF4F5FC" : "FFFFFFFF",
        },
      };
    }
  }
  const help = workbook.addWorksheet("填写说明");
  help.columns = [{ width: 22 }, { width: 110 }];
  const notes = [
    [
      "产品模板使用说明",
      "模板包含一个虚构示例产品，请替换或删除示例后填写自己的产品。",
    ],
    [
      "每个产品一行",
      "只填写一行产品资料、对标图和实拍图。导入解析或保存并解析后，平台自动补出提示词和结果图两行。",
    ],
    [
      "编号、状态、名称",
      "编号必须唯一；名称和资料写在同一格内，用换行分隔。状态由系统维护；保存并解析后这三列会自动纵向合并。",
    ],
    [
      "对标图片",
      "将提示文字替换为真实图片。文字占位符不作为图片导入。图片请使用源表格支持的单元格图片方式。",
    ],
    [
      "实拍图",
      "放在最后的实拍图1、实拍图2…列；数量不限，可继续添加实拍图7、实拍图8等列，空白列会跳过。",
    ],
    [
      "提示词与结果图",
      "导入模板无需填写提示词和结果图。解析后平台自动预留对应行，后续完成生成或切换选定版本时回填。",
    ],
    [
      "导入",
      "点击「导入解析」选择本 XLSX 文件；也可复制表头和数据到在线表格的「外部粘贴」，再点击「保存并解析」。图片能否随复制保留取决于源表格的剪贴板支持。",
    ],
    [
      "继续添加产品",
      "每增加一个产品只需增加一行，替换编号、名称资料和图片。不要把填写说明一起复制进数据区。",
    ],
  ];
  for (const values of notes) {
    const row = help.addRow(values);
    row.height = 48;
    row.eachCell((cell) => {
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.font = { name: "Microsoft YaHei", size: 11 };
    });
  }
  help.getRow(1).font = { name: "Microsoft YaHei", bold: true, size: 12 };
  return workbook.xlsx.writeBuffer();
}
