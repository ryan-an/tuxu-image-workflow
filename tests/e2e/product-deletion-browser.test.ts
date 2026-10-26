import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fixture, password } from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";

test(
  "sidebar reveals delete on hover and keyboard focus, confirms deletion and survives refresh",
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
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      page.setDefaultTimeout(8000);
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(root);
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      const row = page.locator(".product-item").first();
      const remove = row.getByRole("button", {
        name: `删除产品 ${f.product.name}`,
        exact: true,
      });
      await row.waitFor();
      await page.mouse.move(1200, 20);
      assert.equal(
        await remove.evaluate(
          (el: HTMLElement) => getComputedStyle(el).opacity,
        ),
        "0",
      );
      await row.hover();
      await page.waitForTimeout(200);
      const buttonStyle = await remove.evaluate((el: HTMLElement) => {
        const style = getComputedStyle(el);
        return {
          border: style.borderWidth,
          shadow: style.boxShadow,
          background: style.backgroundColor,
        };
      });
      assert.deepEqual(buttonStyle, {
        border: "0px",
        shadow: "none",
        background: "rgba(0, 0, 0, 0)",
      });
      assert.equal(
        await remove.evaluate(
          (el: HTMLElement) => getComputedStyle(el).opacity,
        ),
        "1",
      );
      await page.screenshot({ path: artifactPath("product-delete-hover.png") });
      await remove.click();
      const confirmation = page.getByRole("alertdialog", {
        name: "删除这个产品？",
      });
      await confirmation.waitFor();
      const triggerBounds = (await remove.boundingBox())!;
      const bubbleBounds = (await confirmation.boundingBox())!;
      assert.ok(
        bubbleBounds.x >= triggerBounds.x + triggerBounds.width,
        "气泡应位于删除按钮右侧",
      );
      assert.ok(
        bubbleBounds.y + bubbleBounds.height <= triggerBounds.y,
        "气泡应位于删除按钮上方",
      );
      assert.deepEqual(
        await remove.evaluate((el: HTMLElement) => ({
          border: getComputedStyle(el).borderWidth,
          shadow: getComputedStyle(el).boxShadow,
        })),
        { border: "0px", shadow: "none" },
      );
      await page.screenshot({
        path: artifactPath("product-delete-popover.png"),
      });
      await confirmation
        .getByRole("button", { name: "取消", exact: true })
        .click();
      assert.equal(await confirmation.isVisible(), false);
      assert.equal(await page.locator(".product-item").count(), 1);
      await page.mouse.move(1200, 20);
      await remove.focus();
      await page.waitForTimeout(200);
      assert.equal(
        await remove.evaluate(
          (el: HTMLElement) => getComputedStyle(el).opacity,
        ),
        "1",
      );
      await remove.click();
      await confirmation.waitFor();
      await page.keyboard.press("Escape");
      assert.equal(await confirmation.isVisible(), false);
      await remove.click();
      await confirmation.waitFor();
      await page.mouse.click(1100, 170);
      assert.equal(await confirmation.isVisible(), false);
      await row.hover();
      await remove.click();
      await confirmation.waitFor();
      const deleted = page.waitForResponse(
        (r: any) =>
          r.request().method() === "DELETE" &&
          r.url().includes("/api/products/"),
      );
      await confirmation
        .getByRole("button", { name: "确认删除", exact: true })
        .click();
      assert.equal((await deleted).status(), 200);
      await page.waitForFunction(
        () => document.querySelectorAll(".product-item").length === 0,
      );
      await page.reload();
      await page.locator(".sidebar").waitFor();
      assert.equal(await page.locator(".product-item").count(), 0);
      assert.equal((await f.workflows.repo.view()).products.length, 0);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
