import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fixture, password } from "../support/production.js";
import { Members } from "../../server/production/members.js";
import { artifactPath } from "../support/artifacts.cjs";

test(
  "empty workspace guides creation and sheet import, fits mobile, and respects viewer permissions",
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
      await f.db.query("DELETE FROM products");
      await new Members(f.db).create({
        username: "empty-viewer",
        displayName: "查看者",
        password,
        role: "viewer",
        monthlyLimit: null,
      });
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(root);
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      await page
        .getByRole("heading", { name: "把第一个产品，带进工作台", exact: true })
        .waitFor();
      assert.equal(await page.locator("#batch-bar").isHidden(), true);
      await page.screenshot({
        path: artifactPath("workspace-empty-desktop.png"),
        animations: "disabled",
      });
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page.screenshot({
          path: artifactPath(`workspace-empty-mobile-${width}.png`),
          fullPage: true,
          animations: "disabled",
        });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.locator('[data-action="view"][data-view="queue"]').click();
      await page
        .getByRole("heading", {
          name: "第一套创作，从一个产品开始",
          exact: true,
        })
        .waitFor();
      await page.locator('[data-action="view"][data-view="workbench"]').click();

      const viewer = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      viewer.on("pageerror", (error: Error) => errors.push(error.message));
      await viewer.goto(root);
      await viewer.fill("#login-username", "empty-viewer");
      await viewer.fill("#login-password", password);
      await viewer.click('#login-form button[type="submit"]');
      await viewer
        .getByRole("heading", { name: "这里即将呈现新的作品", exact: true })
        .waitFor();
      assert.equal(
        await viewer.locator('[data-action="new-product"]').count(),
        0,
      );
      assert.equal(
        await viewer
          .getByRole("button", { name: "从表格导入", exact: true })
          .count(),
        0,
      );
      assert.equal(await viewer.locator("#batch-bar").isHidden(), true);
      await viewer.screenshot({
        path: artifactPath("workspace-empty-viewer.png"),
        animations: "disabled",
      });
      await viewer.close();

      await page
        .getByRole("button", { name: "从表格导入", exact: true })
        .click();
      await page
        .locator("#sheet-container canvas")
        .first()
        .waitFor({ timeout: 60000 });
      await page.locator('[data-action="view"][data-view="workbench"]').click();
      await page
        .getByRole("button", { name: "添加第一个产品", exact: true })
        .click();
      await page.locator('#product-form input[name="code"]').fill("FIRST-01");
      await page
        .locator('#product-form input[name="name"]')
        .fill("我的第一个产品");
      const saved = page.waitForResponse(
        (response: any) =>
          new URL(response.url()).pathname === "/api/workspace" &&
          response.request().method() === "PATCH",
      );
      await page.locator('#product-form button[type="submit"]').click();
      await page.locator(".task-card").first().waitFor();
      await saved;
      assert.equal(
        (await f.workflows.repo.view()).products[0].name,
        "我的第一个产品",
      );
      assert.equal(
        await page.locator("#workbench-section .workspace-empty").count(),
        0,
      );
      assert.equal(await page.locator("#batch-bar").isVisible(), true);
      await page.fill("#product-search", "没有这个产品");
      await page.getByRole("button", { name: "清除搜索", exact: true }).click();
      assert.equal(await page.inputValue("#product-search"), "");
      await page
        .locator('[data-action="filter-tasks"][data-filter="selected"]')
        .click();
      await page
        .getByRole("button", { name: "查看全部图片", exact: true })
        .click();
      assert.equal(await page.locator(".task-card").count(), 10);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
