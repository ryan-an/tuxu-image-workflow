import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fixture, password } from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";

test(
  "release notes work without login or JavaScript, retain screenshots on mobile and match the account version",
  { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 60000 },
  async () => {
    const { chromium } = createRequire(import.meta.url)(
      process.env.PLAYWRIGHT_MODULE!,
    );
    const { version } = JSON.parse(
      await readFile(resolve("package.json"), "utf8"),
    );
    const { releases } = JSON.parse(
      await readFile(resolve("docs/releases/releases.json"), "utf8"),
    );
    const title = releases[0].title;
    const f = await fixture(resolve("dist"));
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
    });
    try {
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const staticContext = await browser.newContext({
        javaScriptEnabled: false,
        viewport: { width: 1440, height: 1050 },
      });
      const page = await staticContext.newPage();
      const apiRequests: string[] = [];
      page.on("request", (request: any) => {
        if (new URL(request.url()).pathname.startsWith("/api/"))
          apiRequests.push(request.url());
      });
      const response = await page.goto(`${root}/updates/`);
      assert.equal(response!.status(), 200);
      assert.equal(response!.headers()["cache-control"], "no-store");
      await page.getByRole("heading", { name: title, exact: true }).waitFor();
      assert.equal(await page.locator("figure img").count(), 5);
      await page.screenshot({
        path: artifactPath("release-notes-desktop-fold.png"),
      });
      for (const image of await page.locator("figure img").all()) {
        await image.scrollIntoViewIfNeeded();
        await image.waitFor({ state: "visible" });
        await page.waitForFunction(
          (element: HTMLImageElement) =>
            element.complete && element.naturalWidth > 0,
          await image.elementHandle(),
        );
      }
      assert.deepEqual(apiRequests, []);
      await page.goto(`${root}/updates/`);
      await page.screenshot({
        path: artifactPath("release-notes-desktop.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: artifactPath("release-notes-mobile.png"),
        fullPage: true,
      });
      const metadata = await f.app.inject("/version.json");
      assert.equal(metadata.json().version, version);
      assert.equal(metadata.headers["cache-control"], "no-store");
      const appContext = await browser.newContext();
      const app = await appContext.newPage();
      await app.goto(root);
      await app.fill("#login-password", password);
      await app.click('#login-form button[type="submit"]');
      await app.locator("#account-menu-button").click();
      const link = app.getByRole("link", {
        name: `更新日志 v${version}`,
        exact: true,
      });
      await link.waitFor();
      const popup = app.waitForEvent("popup");
      await link.click();
      await (await popup)
        .getByRole("heading", { name: title, exact: true })
        .waitFor();
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
