import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import sharp from "sharp";
import { fixture, password } from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";

test(
  "activity drawer shows the latest 100 logs in chronological order, starts at the bottom and fits desktop and mobile",
  {
    skip: !process.env.PLAYWRIGHT_MODULE,
    timeout: 60000,
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
      const ids: number[] = [];
      const newest = Date.now();
      await f.db.transaction(async (tx) => {
        for (let index = 0; index < 105; index++) {
          const field = ["facts", "promptRequirements", "prompt", "name"][
            index % 4
          ];
          const changes = [
            {
              path: ["products", product.id, field],
              product: "PLANT-P001",
              role: index % 4 === 2 ? "尺寸图" : undefined,
              before: "花盆尺寸 24 × 28 cm",
              value: "花盆尺寸 26 × 30 cm，画面中清晰标注高度与直径",
            },
          ];
          if (index === 104)
            changes.push({
              path: ["products", product.id, "promptRequirements"],
              product: "PLANT-P001",
              role: undefined,
              before: "浅色背景",
              value: "统一使用米白色背景，保留植物的自然纹理与柔和阴影",
            });
          const result = await tx.query(
            "INSERT INTO workspace_activity(workspace_id,created_at,payload) VALUES($1,$2,$3) RETURNING id",
            [
              "default",
              newest - (104 - index) * 15 * 60 * 1000,
              {
                actor: {
                  displayName: ["陈晓", "林沐", "张予"][index % 3],
                  username: `editor-${index % 3}`,
                },
                changes,
              },
            ],
          );
          ids.push(result.rows[0].id);
        }
      });
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(
        `http://127.0.0.1:${(f.app.server.address() as any).port}`,
      );
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      const open = async () => {
        await page.locator('[data-action="activity"]').click();
        await page.locator('.activity-feed[aria-busy="false"]').waitFor();
        await page
          .locator(".activity-modal")
          .evaluate(async (dialog: HTMLElement) => {
            await Promise.all(
              dialog.getAnimations().map((animation) => animation.finished),
            );
          });
      };
      const closed = () =>
        page.waitForFunction(
          () => !(document.querySelector("#modal") as HTMLDialogElement).open,
        );
      const atBottom = () =>
        page.waitForFunction(() => {
          const feed = document.querySelector(".activity-feed")!;
          return feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 2;
        });
      for (const width of [1440, 390]) {
        const height = width === 1440 ? 1000 : 844;
        await page.setViewportSize({ width, height });
        await open();
        await atBottom();
        assert.deepEqual(
          await page
            .locator(".activity-entry")
            .evaluateAll((entries: HTMLElement[]) =>
              entries.map((entry) => Number(entry.dataset.entryId)),
            ),
          ids.slice(-100),
        );
        assert.equal(
          await page
            .getByRole("button", { name: "查看更多", exact: true })
            .count(),
          0,
        );
        const layout = await page
          .locator(".activity-modal")
          .evaluate((dialog: HTMLDialogElement) => {
            const bounds = dialog.getBoundingClientRect();
            return {
              right: bounds.right,
              top: bounds.top,
              bottom: bounds.bottom,
              width: bounds.width,
              overflow:
                dialog.scrollWidth > dialog.clientWidth ||
                dialog.scrollHeight > dialog.clientHeight,
            };
          });
        const inset = width === 1440 ? 16 : 8;
        assert.ok(
          Math.abs(layout.right - (width - inset)) < 2,
          JSON.stringify(layout),
        );
        assert.ok(
          Math.abs(layout.top - inset) < 2 &&
            Math.abs(layout.bottom - (height - inset)) < 2,
          JSON.stringify(layout),
        );
        assert.equal(layout.overflow, false);
        assert.ok(layout.width <= width - inset * 2);
        await page.locator(".activity-entry summary").last().click();
        await page
          .locator(".activity-entry[open]")
          .getByText("统一使用米白色背景，保留植物的自然纹理与柔和阴影", {
            exact: true,
          })
          .waitFor();
        await atBottom();
        await page
          .locator(".activity-chevron")
          .last()
          .evaluate(async (chevron: HTMLElement) => {
            await Promise.all(
              chevron.getAnimations().map((animation) => animation.finished),
            );
          });
        const detailOverflow = await page
          .locator(".activity-entry[open] .activity-values")
          .evaluateAll((elements: HTMLElement[]) =>
            elements.some(
              (element) => element.scrollWidth > element.clientWidth,
            ),
          );
        assert.equal(detailOverflow, false);
        await page.screenshot({
          path: artifactPath(
            width === 1440
              ? "activity-drawer-desktop.png"
              : "activity-drawer-mobile.png",
          ),
        });
        await page.locator(".activity-feed").evaluate((feed: HTMLElement) => {
          feed.scrollTop = 0;
        });
        await page
          .getByRole("button", { name: "回到最新", exact: true })
          .click();
        await atBottom();
        await page.mouse.click(4, 4);
        await closed();
      }
      await open();
      await page.keyboard.press("Escape");
      await closed();
      await page.route("**/api/workspace/activity", (route: any) =>
        route.fulfill({ status: 503, json: { error: "暂时无法读取操作历史" } }),
      );
      await open();
      await page
        .getByRole("alert")
        .filter({ hasText: "暂时无法读取操作历史" })
        .waitFor();
      await page.unroute("**/api/workspace/activity");
      await page.getByRole("button", { name: "重新读取", exact: true }).click();
      await page.locator('.activity-feed[aria-busy="false"]').waitFor();
      assert.equal(await page.locator(".activity-entry").count(), 100);
      await page
        .getByRole("button", { name: "关闭操作历史", exact: true })
        .click();
      await closed();
      await page.route("**/api/workspace/activity", (route: any) =>
        route.fulfill({ json: { items: [], next: null } }),
      );
      await open();
      await page.getByText("暂无操作记录", { exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "回到最新", exact: true })
          .isDisabled(),
        true,
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
