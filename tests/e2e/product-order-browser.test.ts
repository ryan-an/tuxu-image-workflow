import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import JSZip from "jszip";
import { newProduct, addVersion } from "../../shared/model.js";
import { fixture, password, png } from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";

test(
  "newest products stay first across pages, edits, search and refresh, and sparse downloads keep fixed numbers",
  { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 60000 },
  async () => {
    const { chromium } = createRequire(import.meta.url)(
      process.env.PLAYWRIGHT_MODULE!,
    );
    const f = await fixture(resolve("dist"));
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
    });
    let page: any;
    try {
      const products = Array.from({ length: 35 }, (_, index) => ({
        ...newProduct(
          `SORT-${String(index).padStart(2, "0")}`,
          `排序产品 ${index}`,
        ),
        createdAt: 10000 + index,
      }));
      const latest = products[34];
      for (const index of [0, 2, 6, 9])
        addVersion(latest.tasks[index], png, "已保存提示词");
      await f.db.transaction(async (tx) => {
        await tx.query("DELETE FROM products");
        for (const product of products)
          await f.workflows.repo.saveProduct(tx, product);
      });
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as any).port}`;
      page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        acceptDownloads: true,
      });
      page.setDefaultTimeout(10000);
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(root);
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      const firstCode = page
        .locator(".virtual-product-list .product-code")
        .first();
      await firstCode.waitFor();
      assert.equal(await firstCode.textContent(), "SORT-34");
      await page
        .locator(".page-heading p")
        .filter({ hasText: "SORT-34" })
        .waitFor();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.locator('[data-action="download-selected"]').click(),
      ]);
      await download.saveAs(artifactPath("fixed-position-download.zip"));
      const zip = await JSZip.loadAsync(
        await readFile(artifactPath("fixed-position-download.zip")),
      );
      assert.deepEqual(
        Object.values(zip.files)
          .filter((entry) => !entry.dir)
          .map((entry) => entry.name)
          .sort(),
        [
          "SORT-34/11-A+ 4-V1.png",
          "SORT-34/2-尺寸图-V1.png",
          "SORT-34/4-细节图-V1.png",
          "SORT-34/8-A+ 1-V1.png",
        ],
      );
      const pager = page.locator("#sidebar-content .product-pagination");
      await pager.getByRole("button", { name: "下一页产品" }).click();
      assert.equal(await firstCode.textContent(), "SORT-04");
      await page.getByRole("button", { name: "编辑产品", exact: true }).click();
      await page
        .locator('#product-form [name="name"]')
        .fill("只修改旧产品名称");
      await page.getByRole("button", { name: "保存产品", exact: true }).click();
      assert.equal(await firstCode.textContent(), "SORT-04");
      await pager.getByRole("button", { name: "上一页产品" }).click();
      assert.equal(await firstCode.textContent(), "SORT-34");
      await page
        .getByRole("textbox", { name: "搜索产品", exact: true })
        .fill("SORT-0");
      assert.equal(await firstCode.textContent(), "SORT-09");
      await page
        .getByRole("button", { name: "添加产品", exact: true })
        .filter({ visible: true })
        .click();
      await page.locator('#product-form [name="code"]').fill("AAA-NEWEST");
      await page.locator('#product-form [name="name"]').fill("刚添加的产品");
      const savedProduct = page.waitForResponse(
        (response: any) =>
          response.url() === root + "/api/workspace" &&
          response.request().method() === "PATCH" &&
          response.request().postData()?.includes("AAA-NEWEST"),
      );
      await page.getByRole("button", { name: "保存产品", exact: true }).click();
      assert.equal(
        await page
          .getByRole("textbox", { name: "搜索产品", exact: true })
          .inputValue(),
        "",
      );
      assert.equal(await firstCode.textContent(), "AAA-NEWEST");
      await savedProduct;
      await page.reload();
      await firstCode.waitFor();
      assert.equal(await firstCode.textContent(), "AAA-NEWEST");
      await page.setViewportSize({ width: 390, height: 844 });
      assert.match(
        await page.locator("#mobile-product option").first().textContent(),
        /AAA-NEWEST/,
      );
      await page.screenshot({
        path: artifactPath("products-newest-first-mobile.png"),
      });
      assert.deepEqual(errors, []);
    } catch (error) {
      await page
        ?.screenshot({ path: artifactPath("product-order-failure.png") })
        .catch(() => {});
      throw error;
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
