import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import sharp from "sharp";
import { artifactPath } from "../support/artifacts.cjs";
import { fixture, password, png } from "../support/production.js";
import { addVersion, setPrimary } from "../../shared/model.js";
import { editable, differences } from "../../shared/workspace-edits.js";
import {
  SheetBridge,
  workflowSnapshot,
  cellImages,
} from "../../src/integrations/sheet-bridge.js";

test(
  "sheet backfill protects exact drafts, resolves conflicts and persists incremental prompt and selected image updates",
  {
    skip: !process.env.PLAYWRIGHT_MODULE,
    timeout: 90000,
  },
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
      const original = await f.workflows.repo.view(),
        next = structuredClone(original);
      next.products[0].tasks[0].prompt = "原始提示词";
      next.products[0].tasks[2].prompt = "原始细节提示词";
      next.sheetSnapshot = workflowSnapshot(next);
      const bridge = new SheetBridge(
        next,
        () => {},
        () => {},
      );
      bridge.writeUserCell(2, 4, { v: "我的尺寸草稿" });
      bridge.writeUserCell(2, 6, { v: "我的细节草稿" });
      const product = next.products[0];
      product.tasks[0].prompt = "尺寸分析已完成";
      product.tasks[1].prompt = "卖点分析已完成";
      product.tasks[2].prompt = "细节分析已完成";
      const first = addVersion(product.tasks[0], png, "first", "imported");
      const blue = await sharp({
        create: { width: 3, height: 3, channels: 3, background: "#2244ff" },
      })
        .png()
        .toBuffer();
      const second = addVersion(
        product.tasks[0],
        `data:image/png;base64,${blue.toString("base64")}`,
        "second",
        "imported",
      );
      setPrimary(product.tasks[0], first.id);
      await f.workflows.edit(differences(editable(original), editable(next)));
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      const waitSaved = async (check: (state: any) => boolean) => {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          const state = await f.workflows.repo.view();
          if (check(state)) return state;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.fail("工作表快照未按预期保存");
      };
      const refresh = () =>
        Promise.all([
          page.waitForResponse(
            (response: any) =>
              response.url().includes("/api/workspace/changes?") &&
              response.request().method() === "GET",
          ),
          page.evaluate(() =>
            document.dispatchEvent(new Event("visibilitychange")),
          ),
        ]);
      await page.goto(root);
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      await page.locator('[data-action="view"][data-view="sheet"]').click();
      await page.locator("#sheet-container canvas").first().waitFor();
      await page.getByText("工作流预览", { exact: true }).last().waitFor();
      const conflicts = page.locator(".sheet-conflicts");
      await conflicts.getByText(/有 2 处回填冲突/).waitFor();
      await page.screenshot({
        path: artifactPath("sheet-backfill-conflicts.png"),
      });
      const initialSaved = await waitSaved(
        (state) =>
          state.sheetSnapshot.sheets.preview.cellData[2][5].v ===
          "卖点分析已完成",
      );
      const task = initialSaved.products[0].tasks[0];
      assert.equal(
        cellImages(initialSaved.sheetSnapshot.sheets.preview.cellData[3][4])[0],
        task.versions.find((v: any) => v.id === first.id).source,
      );
      const dimensionConflict = conflicts
        .locator("li")
        .filter({ hasText: "尺寸图" });
      await dimensionConflict
        .getByRole("button", { name: "保留表格修改", exact: true })
        .click();
      await conflicts
        .getByRole("button", { name: "采用生成内容", exact: true })
        .click();
      await conflicts.waitFor({ state: "hidden" });
      await waitSaved(
        (state) =>
          state.sheetSnapshot.sheets.preview.cellData[2][6].v ===
            "细节分析已完成" &&
          state.sheetSnapshot.sheets.preview.rowData[2].custom.workflowDrafts[4]
            ?.base.text === "尺寸分析已完成",
      );

      // Emulate worker completion without changing the sheet document itself.
      const remote = await f.workflows.repo.view(),
        updated = remote.products[0];
      updated.tasks[0].prompt = "第二次尺寸分析完成";
      updated.tasks[1].prompt = "第二次卖点分析完成";
      setPrimary(updated.tasks[0], second.id);
      await f.db.transaction((tx) => f.workflows.repo.saveProduct(tx, updated));
      await refresh();
      await conflicts.getByText(/有 1 处回填冲突/).waitFor();
      const incremental = await waitSaved(
        (state) =>
          state.sheetSnapshot.sheets.preview.cellData[2][5].v ===
          "第二次卖点分析完成",
      );
      assert.equal(
        incremental.sheetSnapshot.sheets.preview.cellData[2][4].v,
        "我的尺寸草稿",
      );
      assert.equal(
        cellImages(incremental.sheetSnapshot.sheets.preview.cellData[3][4])[0],
        updated.tasks[0].versions.find((v) => v.id === second.id)!.source,
      );
      await page.reload();
      await page.locator('[data-action="view"][data-view="sheet"]').click();
      await page.getByText("工作流预览", { exact: true }).last().waitFor();
      await conflicts.getByText(/有 1 处回填冲突/).waitFor();
      await conflicts
        .getByRole("button", { name: "采用生成内容", exact: true })
        .click();
      await conflicts.waitFor({ state: "hidden" });
      const resolved = await waitSaved(
        (state) =>
          state.sheetSnapshot.sheets.preview.cellData[2][4].v ===
          "第二次尺寸分析完成",
      );
      assert.equal(
        resolved.sheetSnapshot.sheets.preview.rowData[2].custom.workflowDirty,
        false,
      );
      assert.deepEqual(
        resolved.sheetSnapshot.sheets.preview.rowData[2].custom.workflowDrafts,
        {},
      );
      await page.reload();
      await page.locator('[data-action="view"][data-view="sheet"]').click();
      await page.locator("#sheet-container canvas").first().waitFor();
      await page.getByText("工作流预览", { exact: true }).last().waitFor();
      assert.equal(
        await conflicts.count(),
        0,
        "系统回填和重载不能产生虚假草稿",
      );
      await page.screenshot({
        path: artifactPath("sheet-backfill-resolved.png"),
      });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
