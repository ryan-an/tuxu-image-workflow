import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import { fixture, password, png } from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";
import { exportSheetTemplate } from "../../src/integrations/sheet-template.js";
import { workflowSnapshot } from "../../shared/sheet-data.js";
import { editable, differences } from "../../shared/workspace-edits.js";

test(
  "single-line clipboard drafts can be deleted, and backend file confirmation imports all 65 products across 30-product pages",
  { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 90000 },
  async () => {
    const { chromium } = createRequire(import.meta.url)(
      process.env.PLAYWRIGHT_MODULE!,
    );
    const f = await fixture(resolve("dist"));
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
    });
    try {
      const initial = await f.workflows.repo.view(),
        next = structuredClone(initial);
      next.sheetSnapshot = workflowSnapshot(next);
      next.sheetSnapshot.sheets.preview.cellData[80] = {
        0: { v: "DELETE-PREVIEW" },
        2: { v: "可删除的预览草稿" },
        3: { v: "示例图" },
      };
      await f.workflows.edit(differences(editable(initial), editable(next)));
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const page = await browser.newPage({
          viewport: { width: 1440, height: 1000 },
        }),
        errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      const waitSaved = async (check: (state: any) => boolean) => {
        const end = Date.now() + 15000;
        while (Date.now() < end) {
          const state = await f.workflows.repo.view();
          if (check(state)) return state;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.fail("工作区没有按预期保存");
      };
      await page.goto(
        `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`,
      );
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      await page.locator('[data-action="view"][data-view="sheet"]').click();
      await page.getByText("外部粘贴", { exact: true }).last().click();
      await page.locator('[data-u-comp="defined-name"] input').waitFor();
      await page.evaluate((image: string) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData(
          "text/html",
          `<table><tr><td>产品编号</td><td>状态</td><td>产品名称 / 资料</td><td>内容</td><td>尺寸图</td></tr><tr><td>PASTE-A</td><td></td><td>草稿A</td><td></td><td><img src="${image}"></td></tr><tr><td>PASTE-B</td><td></td><td>草稿B</td><td></td><td><img src="${image}"></td></tr></table>`,
        );
        document.querySelector("#sheet-container")!.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData,
            bubbles: true,
            cancelable: true,
          }),
        );
      }, png);
      const pasted = await waitSaved(
        (state) =>
          state.sheetSnapshot.sheets.inbox.cellData?.[2]?.[1]?.v === "新建产品",
      );
      assert.equal(
        pasted.sheetSnapshot.sheets.inbox.cellData[1][1].v,
        "新建产品",
      );
      assert.equal(pasted.products.length, 1);
      const nameBox = page.locator('[data-u-comp="defined-name"] input');
      await nameBox.fill("A2");
      await nameBox.press("Enter");
      await page.waitForTimeout(250);
      if ((await nameBox.inputValue()) === "A3")
        await page.keyboard.press("ArrowUp");
      await page.waitForFunction(
        () =>
          (
            document.querySelector(
              '[data-u-comp="defined-name"] input',
            ) as HTMLInputElement
          ).value === "A2",
      );
      await page.evaluate(() => {
        (window as any).paintedRows = [];
        const original = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (
          text,
          x,
          y,
          ...rest
        ) {
          if (/^\d+$/.test(String(text)))
            (window as any).paintedRows.push(Number(text));
          return original.call(this, text, x, y, ...rest);
        };
      });
      await page
        .locator("#sheet-container")
        .hover({ position: { x: 450, y: 350 } });
      await page.mouse.wheel(0, 1800);
      await page.waitForTimeout(400);
      const beforeDelete = await page.evaluate(() =>
        Math.max(...(window as any).paintedRows),
      );
      assert.ok(
        beforeDelete > 20,
        "delete regression must start well below the first rows",
      );
      await page.evaluate(() => {
        (window as any).paintedRows = [];
      });
      await page
        .getByRole("button", { name: "删除选中行", exact: true })
        .click();
      const deleted = await waitSaved(
        (state) => !state.sheetSnapshot.sheets.inbox.cellData[1]?.[0]?.v,
      );
      await page.waitForTimeout(300);
      const afterDelete = await page.evaluate(() =>
        Math.max(...(window as any).paintedRows),
      );
      assert.ok(
        afterDelete >= beforeDelete - 1,
        `deleting must preserve viewport: ${beforeDelete} -> ${afterDelete}`,
      );
      assert.equal(
        deleted.sheetSnapshot.sheets.inbox.cellData[2][0].v,
        "PASTE-B",
      );
      await page
        .getByRole("button", { name: "保存并解析", exact: true })
        .click();
      const dialog = page.locator("#modal");
      await dialog.locator(".parse-products > div").first().waitFor();
      assert.equal(await dialog.locator(".parse-products > div").count(), 1);
      await dialog
        .getByRole("button", { name: "保存并解析", exact: true })
        .click();
      await dialog.waitFor({ state: "hidden" });
      assert.ok(
        (await f.workflows.repo.view()).products.some(
          (p) => p.code === "PASTE-B",
        ),
      );

      await page.locator('[data-action="view"][data-view="sheet"]').click();
      await page.getByText("工作流预览", { exact: true }).last().click();
      await nameBox.fill("A5");
      await nameBox.press("Enter");
      await page.waitForTimeout(250);
      if ((await nameBox.inputValue()) === "A6")
        await page.keyboard.press("ArrowUp");
      await page.waitForFunction(
        () =>
          (
            document.querySelector(
              '[data-u-comp="defined-name"] input',
            ) as HTMLInputElement
          ).value === "A5",
      );
      await page.evaluate(() => {
        (window as any).paintedRows = [];
      });
      await page
        .locator("#sheet-container")
        .hover({ position: { x: 450, y: 350 } });
      await page.mouse.wheel(0, 1800);
      await page.waitForTimeout(400);
      const previewBefore = await page.evaluate(() =>
        Math.max(...(window as any).paintedRows),
      );
      assert.ok(previewBefore > 10);
      await page.evaluate(() => {
        (window as any).paintedRows = [];
      });
      await page
        .getByRole("button", { name: "删除选中行", exact: true })
        .click();
      await page.waitForTimeout(200);
      assert.match(
        await page.locator("#toast").textContent(),
        /已删除/,
        `preview delete: ${await page.locator("#toast").textContent()} ${errors.join(";")}`,
      );
      await waitSaved(
        (state) =>
          !Object.values(state.sheetSnapshot.sheets.preview.cellData).some(
            (cells: any) => cells[0]?.v === "DELETE-PREVIEW",
          ),
      ).catch(async (error: Error) => {
        const remote = await f.workflows.repo.view();
        throw new Error(
          `${error.message}: ${JSON.stringify(
            Object.entries(remote.sheetSnapshot.sheets.preview.cellData)
              .filter(([, cells]: any) => cells[0]?.v)
              .map(([row, cells]: any) => [row, cells[0].v]),
          )}; ${await page.locator("#toast").textContent()}; ${errors.join(";")}`,
        );
      });
      await page.waitForTimeout(300);
      const previewAfter = await page.evaluate(() =>
        Math.max(...(window as any).paintedRows),
      );
      assert.ok(
        previewAfter >= previewBefore - 1,
        `preview viewport must persist: ${previewBefore} -> ${previewAfter}`,
      );

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await exportSheetTemplate());
      const sheet = workbook.worksheets[0];
      sheet.spliceRows(2, 1);
      for (let i = 1; i <= 65; i++)
        sheet.addRow([
          `FILE-${String(i).padStart(3, "0")}`,
          "",
          `文件产品${i}`,
          "示例图",
        ]);
      const id = workbook.addImage({ base64: png, extension: "png" });
      sheet.addImage(id, {
        tl: { col: 4, row: 65 },
        ext: { width: 32, height: 32 },
      });
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      await page.locator('[data-action="view"][data-view="sheet"]').click();
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        page.getByRole("button", { name: "导入解析", exact: true }).click(),
      ]);
      await chooser.setFiles({
        name: "65个产品.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer,
      });
      await dialog.getByText(/后端已解析全部 65/).waitFor();
      assert.equal(await dialog.locator(".parse-advanced").count(), 0);
      assert.equal(await dialog.locator(".parse-products > div").count(), 30);
      assert.equal(
        (await f.workflows.repo.view()).products.length,
        2,
        "confirmation must precede every batch write",
      );
      await dialog
        .getByRole("button", { name: "保存并解析", exact: true })
        .click();
      await dialog.waitFor({ state: "hidden" });
      const imported = await waitSaved((state) => state.products.length === 67);
      assert.equal(imported.jobs.length, 0);
      assert.match(
        imported.products.find((p: any) => p.code === "FILE-065")!.tasks[0]
          .references[0],
        /^\/api\/assets\//,
      );
      assert.equal(
        Object.keys(imported.sheetSnapshot.sheets.preview.cellData).length,
        202,
      );
      await page.getByText("工作流预览", { exact: true }).last().waitFor();
      assert.match(await page.locator(".sheet-pagination").textContent(), /67/);
      await page.screenshot({
        path: artifactPath("sheet-single-row-batch-import.png"),
      });
      await page.reload();
      await page.locator('[data-action="view"][data-view="sheet"]').waitFor();
      assert.equal((await f.workflows.repo.view()).products.length, 67);
      const persistedSheet = (await f.workflows.repo.view()).sheetSnapshot
        .sheets.preview;
      const fileRow = Object.values(persistedSheet.cellData).find(
        (cells: any) => cells[0]?.v === "FILE-001",
      ) as any;
      assert.equal(fileRow[1].v, "已同步");
      assert.equal(fileRow[1].custom.workflowParsed, true);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
