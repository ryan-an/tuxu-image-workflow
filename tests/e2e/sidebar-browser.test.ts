import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { newProduct } from "../../shared/model.js";
import type { Product } from "../../server/production/types.js";
import { fixture, password, png } from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";

test(
  "sidebar keeps long product identifiers on one line, retains distinct suffixes and searches the full identifier",
  { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 45000 },
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
      const samples = [
        [
          "A-2026-AUTUMN-COLLECTION-CERAMIC-COFFEE-CUP-001234",
          "奶油白陶瓷咖啡杯",
        ],
        [
          "A-2026-AUTUMN-COLLECTION-CERAMIC-COFFEE-CUP-005678",
          "暖砂色陶瓷咖啡杯",
        ],
        ["B-012", "轻量随行保温瓶"],
        [
          "C-华东仓库秋季新品系列家居收纳用品组合套装编号000089",
          "桌面收纳盒 · 三件套",
        ],
        [
          "D-2026-" + "LONGCODE".repeat(25) + "007891",
          "产品名称也特别长时仍保持一行，完整名称可以悬停查看",
        ],
        ["E-新品🌿".repeat(8) + "009876", "植物香氛扩香瓶"],
        [
          "F-2026-AUTUMN-COLLECTION-LONG-IDENTIFIER-123456",
          "F-2026-AUTUMN-COLLECTION-LONG-IDENTIFIER-123456",
        ],
      ];
      const products = samples.map(
        ([code, name]) => newProduct(code, name) as Product,
      );
      await f.db.transaction(async (tx) => {
        await tx.query("DELETE FROM products");
        for (const [index, product] of products.entries()) {
          for (const task of product.tasks.slice(
            0,
            index === 0 ? 3 : index === 1 ? 10 : 0,
          )) {
            task.versions.push({
              id: `result-${task.id}`,
              number: 1,
              source: png,
              prompt: "",
              origin: "generated",
              createdAt: Date.now(),
            });
            task.primaryId = task.versions[0].id;
            task.selectedIds = [task.versions[0].id];
          }
          await f.workflows.repo.saveProduct(tx, product);
        }
      });
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(root);
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      await page.locator(".product-item").first().waitFor();
      for (const width of [1440, 1200, 1024, 950, 780, 651]) {
        await page.setViewportSize({ width, height: 1100 });
        const layout = await page
          .locator(".product-list")
          .evaluate((list: HTMLElement) => {
            const bounds = list.getBoundingClientRect();
            return {
              fits: list.scrollWidth <= list.clientWidth,
              rows: Array.from(
                list.querySelectorAll<HTMLElement>(".product-item"),
              ).map((item) => {
                const code = item.querySelector<HTMLElement>(".product-code")!;
                const name = item.querySelector<HTMLElement>(".product-name")!;
                const footer = item.querySelector<HTMLElement>(
                  ".product-completion",
                )!;
                const codeBounds = code.getBoundingClientRect(),
                  nameBounds = name.getBoundingClientRect(),
                  footerBounds = footer.getBoundingClientRect();
                return {
                  height: item.getBoundingClientRect().height,
                  codeHeight: codeBounds.height,
                  codeFits:
                    codeBounds.left >= bounds.left &&
                    codeBounds.right <= bounds.right,
                  separated:
                    nameBounds.bottom <= codeBounds.top &&
                    codeBounds.bottom <= footerBounds.top,
                  footerFits: footer.scrollWidth <= footer.clientWidth,
                };
              }),
            };
          });
        assert.equal(
          layout.fits,
          true,
          `sidebar must not scroll horizontally at ${width}px`,
        );
        assert.equal(layout.rows.length, samples.length);
        for (const row of layout.rows)
          assert.deepEqual(
            row,
            {
              height: 90,
              codeHeight: 14,
              codeFits: true,
              separated: true,
              footerFits: true,
            },
            `product layout at ${width}px`,
          );
      }
      for (const [index, product] of products.entries()) {
        const row = page.locator(`.product-link[data-id="${product.id}"]`);
        assert.equal(
          await row.locator(".product-code").textContent(),
          samples[index][0],
        );
        assert.equal(
          await row.locator(".product-code").getAttribute("title"),
          samples[index][0],
        );
        if (Array.from(product.code).length > 18) {
          const suffix = row.locator(".product-code-suffix");
          assert.equal(
            await suffix.textContent(),
            Array.from(product.code).slice(-6).join(""),
          );
          assert.equal(await suffix.isVisible(), true);
          assert.equal(
            await row
              .locator(".product-code-prefix")
              .evaluate(
                (element: HTMLElement) =>
                  element.scrollWidth > element.clientWidth,
              ),
            true,
          );
        }
      }
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page
        .locator(".sidebar")
        .screenshot({ path: artifactPath("sidebar-products-desktop.png") });
      const listBounds = await page.locator(".product-list").boundingBox();
      assert.ok(listBounds);
      await page.screenshot({
        path: artifactPath("sidebar-product-items.png"),
        clip: { ...listBounds, height: Math.min(294, listBounds.height) },
      });
      await page.setViewportSize({ width: 780, height: 1100 });
      await page
        .locator(".sidebar")
        .screenshot({ path: artifactPath("sidebar-products-narrow.png") });
      const search = page.getByRole("textbox", { name: "搜索产品" });
      await search.fill("CERAMIC-COFFEE-CUP-005678");
      await page.waitForFunction(
        () => document.querySelectorAll(".product-item").length === 1,
      );
      await page.locator(`.product-link[data-id="${products[1].id}"]`).click();
      await page.waitForFunction(
        (name: string) =>
          document.querySelector(".workspace-heading-text h1")?.textContent ===
          name,
        products[1].name,
      );
      assert.equal(
        await page.locator(".product-item.active .product-code").textContent(),
        products[1].code,
      );
      assert.equal(
        (await f.workflows.repo.view()).products.find(
          (product) => product.id === products[1].id,
        )?.code,
        products[1].code,
      );
      await search.fill("NOT-A-PRODUCT");
      await page.getByText("没有匹配的产品", { exact: true }).waitFor();
      await search.fill("");
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.locator("#sidebar-content").isVisible(), false);
      assert.equal(
        await page.locator("#mobile-product option").count(),
        products.length,
      );
      await page.locator("#mobile-product").selectOption(products[0].id);
      await page.waitForFunction(
        (name: string) =>
          document.querySelector(".workspace-heading-text h1")?.textContent ===
          name,
        products[0].name,
      );
      assert.equal(
        await page
          .locator(".sidebar")
          .evaluate(
            (element: HTMLElement) =>
              element.scrollWidth <= element.clientWidth,
          ),
        true,
      );
      await page
        .locator(".sidebar")
        .screenshot({ path: artifactPath("sidebar-products-mobile.png") });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
