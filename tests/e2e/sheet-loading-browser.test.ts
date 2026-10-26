import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fixture, password } from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";

test(
  "sheet loading covers delayed engine imports, respects reduced motion and reveals the ready canvas without replaying on return",
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
    try {
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.route("**/assets/facade-*.js", async (route: any) => {
        await gate;
        await route.continue();
      });
      await page.goto(
        `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`,
      );
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      const sheetTab = page
        .locator('[data-action="view"][data-view="sheet"]')
        .first();
      await sheetTab.click();
      const viewport = page.locator(".sheet-viewport");
      await page.locator('.sheet-viewport[data-state="loading"]').waitFor();
      assert.equal(await viewport.getAttribute("aria-busy"), "true");
      assert.equal(
        await page
          .getByRole("button", { name: "保存并解析", exact: true })
          .isDisabled(),
        true,
      );
      await page.screenshot({ path: artifactPath("sheet-loading.png") });
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(
        await page
          .locator(".sheet-loading-mark span")
          .first()
          .evaluate((el: Element) => getComputedStyle(el).animationName),
        "none",
      );
      await page
        .locator('[data-action="view"][data-view="workbench"]')
        .first()
        .click();
      await sheetTab.click();
      assert.equal(await viewport.getAttribute("data-state"), "loading");
      release();
      await page.locator('.sheet-viewport[data-state="ready"]').waitFor();
      assert.equal(await viewport.getAttribute("aria-busy"), "false");
      assert.equal(
        await page.locator("#sheet-container").getAttribute("inert"),
        null,
      );
      assert.equal(
        await page
          .locator(".sheet-loading")
          .evaluate((el: Element) => getComputedStyle(el).visibility),
        "hidden",
      );
      assert.ok((await page.locator("#sheet-container canvas").count()) > 0);
      await page
        .locator('[data-action="view"][data-view="workbench"]')
        .first()
        .click();
      await sheetTab.click();
      assert.equal(await viewport.getAttribute("data-state"), "ready");
      assert.deepEqual(errors, []);
    } finally {
      release();
      await browser.close();
      await f.close();
    }
  },
);
