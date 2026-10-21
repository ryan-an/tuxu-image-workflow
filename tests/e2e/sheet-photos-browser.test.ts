import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import sharp from "sharp";
import { fixture, password } from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";
import {
  workflowSnapshot,
  imageCell,
  detectColumns,
} from "../../src/integrations/sheet-bridge.js";
import { editable, differences } from "../../shared/workspace-edits.js";
import { ROLES } from "../../shared/model.js";

test(
  "eight trailing photo columns import into the product photo list without an album cell",
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
      const photos = [];
      for (let i = 0; i < 8; i++)
        photos.push(
          await f.workflows.assets.put(
            await sharp({
              create: {
                width: 32,
                height: 32,
                channels: 3,
                background: { r: i * 30, g: 90, b: 120 },
              },
            })
              .png()
              .toBuffer(),
            "image/png",
          ),
        );
      const original = await f.workflows.repo.view();
      const changed = structuredClone(original);
      changed.sheetSnapshot = workflowSnapshot(changed);
      const source = changed.sheetSnapshot.sheets.inbox;
      const labels = [
        "序列",
        "编号",
        "产品信息",
        ...ROLES.map((role, i) => `${i + 2}${role}`),
        ...photos.map((_, i) => `实拍图${i + 1}`),
      ];
      source.cellData = {
        0: Object.fromEntries(labels.map((v, c) => [c, { v }])),
        1: {
          0: { v: "第一套" },
          1: { v: f.product.code },
          2: { v: "多张实拍产品\n产品资料" },
        },
      };
      photos.forEach(
        (image, i) =>
          (source.cellData[1][3 + ROLES.length + i] = imageCell(image)),
      );
      await f.workflows.edit(
        differences(editable(original), editable(changed)),
      );
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as any).port}`;
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(e.message));
      await page.goto(root);
      await page.fill("#login-username", "admin");
      await page.fill("#login-password", password);
      await page.click("#login-form button[type=submit]");
      await page.locator("[data-action=view][data-view=sheet]").click();
      await page.locator("#sheet-container canvas").first().waitFor();
      await page.getByText("外部粘贴", { exact: true }).last().click();
      await page
        .getByRole("button", { name: "保存并解析", exact: true })
        .click();
      await page.locator(".parse-products > div").first().waitFor();
      assert.match(
        await page.locator(".parse-products").textContent(),
        /8 张实拍图/,
      );
      await page.screenshot({
        path: artifactPath("trailing-photo-import.png"),
      });
      await page
        .locator("#modal")
        .getByRole("button", { name: "保存并解析", exact: true })
        .click();
      await page.waitForFunction(
        () => !(document.querySelector("#modal") as HTMLDialogElement)?.open,
      );
      const saved = (await f.workflows.repo.view()).products[0];
      assert.deepEqual(saved.photos, photos);
      assert.equal(saved.photo, photos[0]);
      const snapshot = (await f.workflows.repo.view()).sheetSnapshot;
      const mapping = detectColumns(snapshot.sheets.preview);
      assert.ok(mapping.photoColumns[0] > Math.max(...mapping.roles));
      assert.equal(mapping.photoColumns.length, 8);
      await page.reload();
      await page.locator("[data-action=view][data-view=sheet]").waitFor();
      assert.deepEqual(
        (await f.workflows.repo.view()).products[0].photos,
        photos,
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
