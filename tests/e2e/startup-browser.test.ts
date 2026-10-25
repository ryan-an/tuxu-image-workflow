import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fixture, password } from "../support/production.js";
import { newProduct } from "../../shared/model.js";
import { artifactPath } from "../support/artifacts.cjs";

test(
  "the workspace shell appears before product details and loads other products and history only on demand",
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
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let releaseSession!: () => void;
    const sessionGate = new Promise<void>((resolve) => {
      releaseSession = resolve;
    });
    try {
      const other = newProduct("ZZ-SECOND", "第二个产品");
      other.tasks[0].prompt =
        "only load this prompt when the product is opened";
      await f.workflows.repo.saveProduct(f.db, other);
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const requests: string[] = [],
        errors: string[] = [];
      page.on("request", (request: any) =>
        requests.push(
          new URL(request.url()).pathname + new URL(request.url()).search,
        ),
      );
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.route("**/api/auth/session**", async (route: any) => {
        await sessionGate;
        await route.continue();
      });
      await page.route("**/api/workspace/products?**", async (route: any) => {
        if (
          new URL(route.request().url()).searchParams.get("ids") ===
          f.product.id
        )
          await gate;
        await route.continue();
      });
      await page.goto(root);
      const opening = page.locator(".workspace-loading-screen");
      await opening.waitFor();
      assert.equal(await opening.getAttribute("aria-busy"), "true");
      await page.screenshot({
        path: artifactPath("workspace-opening-desktop.png"),
        animations: "disabled",
      });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: artifactPath("workspace-opening-mobile.png"),
        animations: "disabled",
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(
        await page
          .locator(".workspace-loading-frame.is-front")
          .evaluate(
            (element: Element) => getComputedStyle(element).animationName,
          ),
        "none",
      );
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.setViewportSize({ width: 1440, height: 1000 });
      releaseSession();
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      await page.locator(".topbar").waitFor();
      await page
        .getByText("正在加载产品图片和提示词…", { exact: true })
        .waitFor();
      await page.getByRole("button", { name: /^设置：/ }).click();
      await page.locator("#settings-form").waitFor();
      assert.ok(!requests.includes("/api/workspace"));
      assert.ok(!requests.some((url) => url.includes("/api/jobs/history")));
      assert.ok(!requests.some((url) => url.includes(other.id)));
      assert.ok(!requests.includes("/api/workspace/sheet"));
      await page.keyboard.press("Escape");
      await page.screenshot({
        path: artifactPath("startup-before-product-details.png"),
      });
      assert.equal(await page.locator(".workspace-skeleton-card").count(), 2);
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: artifactPath("workspace-loading-product-mobile.png"),
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(
        await page
          .locator(".workspace-shimmer")
          .first()
          .evaluate(
            (element: Element) =>
              getComputedStyle(element, "::after").animationName,
          ),
        "none",
      );
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.setViewportSize({ width: 1440, height: 1000 });
      release();
      await page.locator(".task-card").first().waitFor();
      assert.equal(await page.locator(".workspace-loading-product").count(), 0);
      await page
        .locator(`[data-action="open-product"][data-id="${other.id}"]`)
        .click();
      await page
        .locator(".workspace-heading-text h1")
        .filter({ hasText: "第二个产品" })
        .waitFor();
      await page
        .getByText(other.tasks[0].prompt, { exact: true })
        .first()
        .waitFor();
      assert.ok(
        requests.some(
          (url) =>
            url.includes("/api/workspace/products?") && url.includes(other.id),
        ),
      );
      assert.ok(!requests.includes("/api/workspace"));
      await page.locator('[data-action="view"][data-view="queue"]').click();
      await page.getByRole("tab", { name: /任务明细/ }).click();
      await page.getByText(/第 1 \/ 1 页 · 每页 50 条/).waitFor();
      assert.ok(requests.some((url) => url.includes("/api/jobs/history?")));
      assert.deepEqual(errors, []);
    } finally {
      releaseSession();
      release();
      await browser.close();
      await f.close();
    }
  },
);
