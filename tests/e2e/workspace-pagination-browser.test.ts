import { artifactPath } from "../support/artifacts.cjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fixture, password } from "../support/production.js";
import { newProduct } from "../../shared/model.js";

test(
  "1000 products: shared 30-item pages, virtual list, scoped parsing, search, mobile and incremental polling",
  { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 120000 },
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
      await f.db.transaction(async (tx) => {
        await tx.query("DELETE FROM products");
        for (let i = 0; i < 1000; i++)
          await f.workflows.repo.saveProduct(
            tx,
            newProduct(`P${String(i).padStart(4, "0")}`, `产品${i}`, ""),
          );
      });
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as any).port}`;
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => {
        errors.push(e.message);
        console.log("BROWSER ERROR", e.message);
      });
      let fullReads = 0,
        changes = 0;
      page.on("request", (r: any) => {
        if (r.method() === "GET" && r.url() === root + "/api/workspace")
          fullReads++;
        if (r.url().includes("/api/workspace/changes?")) changes++;
      });
      await page.goto(root);
      await page.fill("#login-username", "admin");
      await page.fill("#login-password", password);
      await page.click("#login-form button[type=submit]");
      await page
        .locator(".virtual-product-list .product-item")
        .first()
        .waitFor();
      assert.ok((await page.locator(".product-item").count()) < 15);
      await page.locator("[data-action=view][data-view=sheet]").click();
      await page
        .locator("#sheet-container canvas")
        .first()
        .waitFor({ timeout: 60000 });
      const pager = page.locator(".sheet-toolbar-pagination .sheet-pagination");
      assert.match(await pager.textContent(), /第 1 \/ 34 页/);
      const toolbarPager = page.locator(
        ".sheet-toolbar-pagination .sheet-pagination",
      );
      assert.match(await toolbarPager.textContent(), /第 1 \/ 34 页/);
      await toolbarPager.getByRole("button", { name: "下一页产品" }).click();
      await page.waitForFunction(() =>
        document
          .querySelector(".sheet-toolbar-pagination .sheet-pagination")
          ?.textContent?.includes("第 2 / 34 页"),
      );
      assert.equal(
        await page
          .locator(".virtual-product-list .product-code")
          .first()
          .textContent(),
        "P0030",
      );
      assert.match(await toolbarPager.textContent(), /第 2 \/ 34 页/);
      await page.locator("[data-action=view][data-view=workbench]").click();
      assert.equal(
        await page
          .locator(".virtual-product-list .product-code")
          .first()
          .textContent(),
        "P0030",
      );
      await page.locator("[data-action=view][data-view=sheet]").click();
      assert.match(await toolbarPager.textContent(), /第 2 \/ 34 页/);
      await page.locator("[data-action=parse-sheet]").click();
      await page.locator(".parse-products > div").first().waitFor();
      assert.equal(await page.locator(".parse-products > div").count(), 30);
      assert.equal(
        await page.locator(".parse-products strong").first().textContent(),
        "P0030",
      );
      await page.keyboard.press("Escape");
      await page.getByRole("textbox", { name: "搜索产品" }).fill("P0999");
      try {
        await page.waitForFunction(
          () =>
            document.querySelector(".virtual-product-list .product-code")
              ?.textContent === "P0999",
          {},
          { timeout: 5000 },
        );
      } catch (e) {
        await page.screenshot({ path: artifactPath("scaling-debug.png") });
        console.log(
          "DEBUG",
          await page.locator("#toast").textContent(),
          await page.locator(".virtual-product-list").textContent(),
          await pager.textContent(),
        );
        throw e;
      }
      await page.locator("[data-action=parse-sheet]").click();
      await page.locator(".parse-products > div").first().waitFor();
      assert.equal(await page.locator(".parse-products > div").count(), 1);
      await page.keyboard.press("Escape");
      await page.getByRole("textbox", { name: "搜索产品" }).fill("");
      await Promise.all([
        page.waitForResponse((response: any) =>
          response.url().includes("/api/workspace/changes?"),
        ),
        page.evaluate(() =>
          document.dispatchEvent(new Event("visibilitychange")),
        ),
      ]);
      assert.equal(fullReads, 1);
      assert.ok(changes > 0);
      await page.screenshot({
        path: artifactPath("workspace-scaling-desktop.png"),
      });
      await page.setViewportSize({ width: 390, height: 844 });
      const mobile = page.locator(".mobile-product-pagination");
      assert.ok(await mobile.isVisible());
      await mobile.getByRole("button", { name: "下一页产品" }).click();
      assert.match(await pager.textContent(), /第 2 \/ 34 页/);
      await page.screenshot({
        path: artifactPath("workspace-scaling-mobile.png"),
      });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
