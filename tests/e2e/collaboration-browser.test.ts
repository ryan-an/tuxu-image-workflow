import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fixture, password } from "../support/production.js";
import { Members } from "../../server/production/members.js";
import { artifactPath } from "../support/artifacts.cjs";
import sharp from "sharp";
import { cellText } from "../../src/integrations/sheet-bridge.js";

test(
  "two editors see cell selections, receive committed cell changes and inspect attributed activity",
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
      const bytes = await sharp({
        create: { width: 32, height: 32, channels: 3, background: "#aabbcc" },
      })
        .png()
        .toBuffer();
      const source = await f.workflows.assets.normalize(
        `data:image/png;base64,${bytes.toString("base64")}`,
      );
      const product = (await f.workflows.repo.view()).products[0];
      product.photo = source;
      product.photos = [source];
      for (const task of product.tasks) task.references = [source];
      await f.workflows.repo.saveProduct(f.db, product);
      for (const suffix of ["a", "b"])
        await new Members(f.db).create({
          username: `collab-${suffix}`,
          displayName: `协作者${suffix.toUpperCase()}`,
          password,
          role: "editor",
          monthlyLimit: null,
        });
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as any).port}`;
      const pages: any[] = [];
      const errors: string[] = [];
      for (const suffix of ["a", "b"]) {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
        });
        const page = await context.newPage();
        pages.push(page);
        page.on("pageerror", (error: Error) => errors.push(error.message));
        await page.goto(root);
        await page.fill("#login-username", `collab-${suffix}`);
        await page.fill("#login-password", password);
        await page.click('#login-form button[type="submit"]');
        await page.locator('[data-action="view"][data-view="sheet"]').click();
        await page
          .locator('#sheet-container [data-u-comp="defined-name"] input')
          .waitFor();
        await page.getByText("工作流预览", { exact: true }).last().waitFor();
        await page.getByText("工作流预览", { exact: true }).last().click();
        const grid = await page
          .locator("#sheet-container canvas")
          .evaluateAll((items: HTMLCanvasElement[]) => {
            const item = items.find((item) => item.clientHeight > 200)!;
            const rect = item.getBoundingClientRect();
            return { x: rect.x, y: rect.y };
          });
        await page.mouse.click(grid.x + 760, grid.y + 240);
      }
      const [a, b] = pages;
      async function select(page: any, cell: string) {
        const box = page.locator(
          '#sheet-container [data-u-comp="defined-name"] input',
        );
        await box.fill(cell);
        await box.press("Enter");
      }
      async function waitCell(column: number, value: string) {
        const deadline = Date.now() + 12000;
        while (Date.now() < deadline) {
          const state = await f.workflows.repo.view();
          if (
            cellText(
              state.sheetSnapshot?.sheets.preview.cellData[2]?.[column],
            ) === value
          )
            return;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.fail(`cell ${column} never saved as ${value}`);
      }
      await select(a, "E3");
      await b
        .locator(".sheet-collaborator-label")
        .filter({ hasText: "协作者A" })
        .waitFor();
      await a.keyboard.type("Cell from A");
      await a.keyboard.press("Enter");
      await waitCell(4, "Cell from A");
      await select(b, "F3");
      await a
        .locator(".sheet-collaborator-label")
        .filter({ hasText: "协作者B" })
        .waitFor();
      await b.keyboard.type("Cell from B");
      await b.keyboard.press("Enter");
      await waitCell(5, "Cell from B");
      // Make the receiving browser commit another cell. If its mounted workbook
      // was stale, capture would send the old E3 back and erase A's edit.
      await select(b, "G3");
      await b.keyboard.type("Second cell B");
      await b.keyboard.press("Enter");
      await waitCell(6, "Second cell B");
      assert.equal(
        cellText(
          (await f.workflows.repo.view()).sheetSnapshot.sheets.preview
            .cellData[2][4],
        ),
        "Cell from A",
        JSON.stringify(
          (await f.workflows.repo.view()).sheetSnapshot.sheets.preview
            .cellData[2][4],
        ),
      );
      await select(b, "E3");
      await b.keyboard.type("Latest B");
      await b.keyboard.press("Enter");
      await waitCell(4, "Latest B");
      await a.locator('[data-action="activity"]').click();
      await a
        .locator(".activity-entry summary")
        .filter({ hasText: "协作者B" })
        .last()
        .waitFor();
      await a
        .locator(".activity-entry summary")
        .filter({ hasText: "协作者B" })
        .last()
        .click();
      await a
        .locator(".activity-dialog")
        .getByText("Latest B", { exact: true })
        .waitFor();
      await a.screenshot({ path: artifactPath("collaboration-activity.png") });
      await a.keyboard.press("Escape");
      await select(b, "F3");
      await a.screenshot({ path: artifactPath("collaboration-selection.png") });
      await b.close();
      await a
        .locator(".sheet-collaborator-label")
        .filter({ hasText: "协作者B" })
        .waitFor({ state: "detached" });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
