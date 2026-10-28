import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fixture, password } from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";

test(
  "topbar tools fit narrow screens and account actions support keyboard, dismissal and logout retry",
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
        viewport: { width: 1440, height: 960 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(root);
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      const trigger = page.getByRole("button", {
        name: "账号菜单",
        exact: true,
      });
      await trigger.waitFor();
      const actions = page.locator(".top-actions");
      for (const width of [
        1920, 1440, 1280, 1100, 1024, 900, 780, 650, 480, 390, 320,
      ]) {
        await page.setViewportSize({ width, height: 960 });
        const layout = await actions.evaluate((element: HTMLElement) => {
          const bounds = element.getBoundingClientRect();
          const items = Array.from(element.children).map((child) =>
            child.getBoundingClientRect(),
          );
          return {
            within: bounds.left >= 0 && bounds.right <= innerWidth,
            fits: element.scrollWidth <= element.clientWidth,
            separated: items.every(
              (item, index) =>
                !index || item.left >= items[index - 1].right - 1,
            ),
          };
        });
        assert.deepEqual(
          layout,
          { within: true, fits: true, separated: true },
          `toolbar at ${width}px`,
        );
        for (const name of ["操作历史", "工作区管理", "成员管理"]) {
          assert.equal(
            await page.getByRole("button", { name, exact: true }).isVisible(),
            true,
          );
        }
        await trigger.click();
        const panel = page.getByRole("group", {
          name: "账号选项",
          exact: true,
        });
        assert.equal(await panel.isVisible(), true);
        const bounds = await panel.boundingBox();
        assert.ok(
          bounds && bounds.x >= 0 && bounds.x + bounds.width <= width,
          `account panel at ${width}px`,
        );
        await page.keyboard.press("Escape");
        await page.waitForFunction(
          () =>
            document
              .querySelector("#account-menu-button")
              ?.getAttribute("aria-expanded") === "false",
        );
      }
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.locator(".topbar").click({ position: { x: 500, y: 12 } });
      await page
        .locator(".topbar")
        .screenshot({ path: artifactPath("topbar-desktop.png") });
      await trigger.focus();
      await page.keyboard.press("ArrowDown");
      const adminEntry = page.getByRole("button", {
        name: "超级管理台",
        exact: true,
      });
      const logout = page.getByRole("button", {
        name: "退出登录",
        exact: true,
      });
      assert.equal(
        await adminEntry.evaluate(
          (element: Element) => element === document.activeElement,
        ),
        true,
        "keyboard opening focuses the first available account action",
      );
      await page.keyboard.press("Tab");
      assert.equal(
        await page
          .locator(".account-release-link")
          .evaluate((element: Element) => element === document.activeElement),
        true,
        "the release notes link remains keyboard accessible",
      );
      await page.keyboard.press("Tab");
      assert.equal(
        await logout.evaluate(
          (element: Element) => element === document.activeElement,
        ),
        true,
        "logout remains reachable after the admin entry and release notes",
      );
      await page.screenshot({
        path: artifactPath("topbar-account-menu.png"),
        clip: { x: 840, y: 0, width: 600, height: 340 },
      });
      await page.locator(".topbar").click({ position: { x: 500, y: 12 } });
      await page.waitForFunction(
        () =>
          document
            .querySelector("#account-menu-button")
            ?.getAttribute("aria-expanded") === "false",
      );

      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .locator(".topbar")
        .screenshot({ path: artifactPath("topbar-mobile.png") });
      await trigger.click();
      await page.route("**/api/auth/logout", (route: any) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "退出失败，请重试" }),
        }),
      );
      await logout.click();
      await page.locator(".account-logout-error").waitFor();
      assert.equal(await logout.isEnabled(), true);
      assert.equal(await trigger.getAttribute("aria-expanded"), "true");
      await page.unroute("**/api/auth/logout");
      await logout.click();
      await page.locator("#login-form").waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
