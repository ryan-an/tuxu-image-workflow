import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fixture, password } from "../support/production.js";
import { addVersion, newProduct } from "../../shared/model.js";
import {
  SheetBridge,
  workflowSnapshot,
} from "../../src/integrations/sheet-bridge.js";
import { editable, differences } from "../../shared/workspace-edits.js";

test(
  "parser counts real creates and updates, selects the last saved product and excludes unchanged products on reopening",
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
      const original = await f.workflows.repo.view(),
        next = structuredClone(original);
      const updated = newProduct("B-UPDATE", "本次更新"),
        fresh = newProduct("C-NEW", "本次最后保存"),
        tail = newProduct("D-SYNCED", "末尾已同步");
      next.products.push(updated as any, tail as any);
      next.sheetSnapshot = workflowSnapshot({
        products: [next.products[0], updated, fresh, tail],
      });
      // Clipboard-created rows have no workspace product binding until parsed.
      for (const row of [7, 8, 9])
        delete next.sheetSnapshot.sheets.preview.rowData[row].custom
          .workflowProductId;
      const bridge = new SheetBridge(
        next,
        () => {},
        () => {},
      );
      for (const product of next.products)
        bridge.markProductParsed(product.code);
      bridge.writeUserCell(5, 4, { v: "本次更新的提示词" });
      await f.workflows.edit(differences(editable(original), editable(next)));
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as any).port}`;
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(root);
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      await page.locator('[data-action="view"][data-view="sheet"]').click();
      await page.locator("#sheet-container canvas").first().waitFor();
      await page.locator('[data-action="parse-sheet"]').click();
      const dialog = page.locator("#modal");
      await dialog.locator(".parse-summary").waitFor();
      assert.equal(
        await dialog.locator(".parse-summary strong").textContent(),
        "2",
        await dialog.locator(".parse-products").textContent(),
      );
      assert.equal(
        await dialog
          .locator(".parse-products > div")
          .filter({ hasText: "待保存" })
          .count(),
        2,
      );
      await dialog.locator('[data-action="confirm-parse"]').click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(
        await page.locator(".workspace-heading-text h1").textContent(),
        "本次最后保存",
      );
      assert.equal(
        await page
          .locator('.product-link[aria-current="true"] .product-code')
          .textContent(),
        "C-NEW",
      );
      assert.match(
        await page.locator("#toast").textContent(),
        /新增 1 个，更新 1 个/,
      );
      await page.locator('[data-action="view"][data-view="sheet"]').click();
      await page.locator('[data-action="parse-sheet"]').click();
      await dialog.locator(".parse-summary").waitFor();
      assert.equal(
        await dialog.locator(".parse-summary strong").textContent(),
        "0",
      );
      assert.equal(
        await dialog
          .getByText("所有产品已同步，无需更新。", { exact: true })
          .count(),
        1,
      );
      const saved = await f.workflows.repo.view();
      for (const row of [1, 4, 7, 10])
        assert.equal(
          saved.sheetSnapshot.sheets.preview.cellData[row][1].v,
          "已同步",
        );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);

test(
  "save and parse completes missing product rows and merges metadata in the mounted sheet and after reload",
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
      const initial = await f.workflows.repo.view(),
        next = structuredClone(initial);
      next.products[0].tasks[0].prompt = "缺行时也要保留的提示词";
      const version = addVersion(
        next.products[0].tasks[0],
        next.products[0].tasks[0].references[0],
        "existing",
        "imported",
      );
      next.sheetSnapshot = workflowSnapshot(next);
      next.sheetSnapshot.sheets.preview.mergeData = [];
      delete next.sheetSnapshot.sheets.preview.cellData[2];
      delete next.sheetSnapshot.sheets.preview.cellData[3];
      await f.workflows.edit(differences(editable(initial), editable(next)));
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(root);
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      const sheetTab = page.locator('[data-action="view"][data-view="sheet"]');
      const parse = async () => {
        await sheetTab.click();
        await page.locator('[data-u-comp="defined-name"] input').waitFor();
        await page
          .getByRole("button", { name: "保存并解析", exact: true })
          .click();
        const dialog = page.locator("#modal");
        await dialog.locator(".parse-products > div").first().waitFor();
        await dialog
          .getByRole("button", { name: "保存并解析", exact: true })
          .click();
        await dialog.waitFor({ state: "hidden" });
      };
      await parse();
      const saved = await f.workflows.repo.view(),
        sheet = saved.sheetSnapshot.sheets.preview;
      assert.deepEqual(
        [1, 2, 3].map((row) => sheet.cellData[row][3].v),
        ["示例图", "提示词", "结果图"],
      );
      assert.equal(sheet.cellData[2][4].v, "缺行时也要保留的提示词");
      assert.equal(saved.products[0].tasks[0].primaryId, version.id);
      assert.equal(saved.products[0].tasks[0].versions.length, 1);
      assert.equal(saved.jobs.length, 0, "补齐行不能发起生成任务");
      for (const column of [0, 1, 2])
        assert.ok(
          sheet.mergeData.some(
            (m: any) =>
              m.startRow === 1 &&
              m.endRow === 3 &&
              m.startColumn === column &&
              m.endColumn === column,
          ),
        );
      await sheetTab.click();
      await page.locator('[data-u-comp="defined-name"] input').waitFor();
      await page.reload();
      await parse();
      const reloaded = (await f.workflows.repo.view()).sheetSnapshot.sheets
        .preview;
      assert.deepEqual(Object.keys(reloaded.cellData), ["0", "1", "2", "3"]);
      assert.equal(reloaded.mergeData.length, 3);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);

test(
  "save and parse keeps advanced settings collapsed and commits drafts only after confirmation",
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
      const state = await f.workflows.repo.view();
      const changed = structuredClone(state);
      changed.products[0].tasks[0].prompt = "工作区原提示词";
      changed.sheetSnapshot = workflowSnapshot(changed);
      changed.sheetSnapshot.sheets.preview.cellData[2][4] = {
        v: "表格草稿\n第二行",
      };
      changed.sheetSnapshot.sheets.preview.rowData[2].custom.workflowDirty = true;
      await f.workflows.edit(differences(editable(state), editable(changed)));
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as any).port}`;
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(root);
      await page.fill("#login-username", "admin");
      await page.fill("#login-password", password);
      await page.click("#login-form button[type=submit]");
      await page.locator("[data-action=view][data-view=sheet]").click();
      await page.locator("#sheet-container canvas").first().waitFor();
      assert.match(
        await page.locator(".sheet-live-label").textContent(),
        /实时更新/,
      );
      await page
        .getByRole("button", { name: "保存并解析", exact: true })
        .click();
      const dialog = page.locator("#modal");
      try {
        await dialog
          .locator(".parse-products > div")
          .first()
          .waitFor({ timeout: 5000 });
      } catch (error) {
        console.log(
          "PARSE DEBUG",
          await page.locator("#toast").textContent(),
          await dialog.textContent(),
          errors,
        );
        throw error;
      }
      assert.equal(
        await dialog.locator(".parse-advanced").getAttribute("open"),
        null,
      );
      assert.equal(await dialog.locator("#parse-layout").isVisible(), false);
      assert.equal(
        (await f.workflows.repo.view()).products[0].tasks[0].prompt,
        "工作区原提示词",
      );
      await dialog.getByText("高级配置", { exact: true }).click();
      assert.equal(await dialog.locator("#parse-layout").isVisible(), true);
      await dialog.getByLabel("尺寸图", { exact: true }).selectOption("0");
      assert.equal(
        await dialog.locator("[data-action=confirm-parse]").isDisabled(),
        true,
      );
      assert.match(
        await dialog.locator("[role=alert]").textContent(),
        /同一列/,
      );
      await dialog.getByLabel("尺寸图", { exact: true }).selectOption("4");
      await dialog.getByText("高级配置", { exact: true }).click();
      await dialog
        .getByRole("button", { name: "保存并解析", exact: true })
        .click();
      await dialog.waitFor({ state: "hidden" });
      const saved = await f.workflows.repo.view();
      assert.equal(saved.products[0].tasks[0].prompt, "表格草稿\n第二行");
      assert.equal(
        saved.products[0].tasks[0].promptHistory.at(-1).prompt,
        "工作区原提示词",
      );
      assert.equal(
        saved.sheetSnapshot.sheets.preview.cellData[1][1].v,
        "已同步",
      );
      await page.locator("[data-action=view][data-view=sheet]").click();
      await page
        .getByRole("button", { name: "保存并解析", exact: true })
        .click();
      await dialog.locator(".parse-products > div").first().waitFor();
      assert.equal(await dialog.locator("#parse-layout").isVisible(), false);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
