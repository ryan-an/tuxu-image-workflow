import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fixture, password } from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";

test(
  "single split button switches suite actions without executing, footer contains download only",
  { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 30000 },
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
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      page.setDefaultTimeout(6000);
      await page.goto(
        `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`,
      );
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      await page.locator(".suite-action-control").waitFor();
      assert.equal(await page.locator("#batch-bar button").count(), 1);
      assert.equal(
        await page.locator("#batch-bar button").innerText(),
        "下载本套选中图片",
      );
      const toggle = page.getByLabel("切换生成操作", { exact: true }),
        options = page.getByRole("group", { name: "生成操作", exact: true });
      await toggle.click();
      assert.equal(
        await options
          .getByRole("button", { name: "一键生成本套图片", exact: false })
          .isDisabled(),
        true,
      );
      await options
        .getByRole("button", { name: "执行本套工作流", exact: false })
        .click();
      const workflow = page.locator(".suite-action-control > button");
      assert.equal(await workflow.innerText(), "执行本套工作流");
      assert.match(
        (await workflow.getAttribute("title"))!,
        /先生成整套提示词.*自动生成/,
      );
      assert.equal((await f.workflows.repo.view()).jobs.length, 0);
      await workflow.click();
      await page
        .getByRole("button", {
          name: "生成整套提示词中，点击终止",
          exact: true,
        })
        .waitFor();
      assert.equal((await f.workflows.repo.view()).jobs.length, 11);
      await page
        .getByRole("button", {
          name: "生成整套提示词中，点击终止",
          exact: true,
        })
        .click();
      await f.workflows.edit(
        f.product.tasks.map((task) => ({
          path: ["products", f.product.id, "tasks", task.id, "prompt"],
          before: "",
          value: "已保存提示词",
        })),
      );
      await page.reload();
      await page.locator(".suite-action-control > button").click();
      const stop = page.getByRole("button", {
        name: "生成整套提示词中，点击终止",
        exact: true,
      });
      await stop.waitFor();
      await toggle.click();
      assert.equal(
        await options
          .getByRole("button", { name: "一键生成本套图片", exact: false })
          .isDisabled(),
        true,
      );
      await page.keyboard.press("Escape");
      await stop.click();
      await page
        .getByRole("button", { name: "生成整套提示词", exact: true })
        .waitFor();
      await toggle.click();
      await options
        .getByRole("button", { name: "一键生成本套图片", exact: false })
        .click();
      assert.equal(await workflow.innerText(), "一键生成本套图片");
      await page.setViewportSize({ width: 390, height: 844 });
      await toggle.click();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      const menuBounds = await options.boundingBox();
      assert.ok(
        menuBounds &&
          menuBounds.x >= 0 &&
          menuBounds.x + menuBounds.width <= 390,
      );
      await page.screenshot({
        path: artifactPath("suite-actions-mobile.png"),
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      const submitted = page.waitForRequest(
        (request: any) =>
          request.url().endsWith("/api/jobs") && request.method() === "POST",
      );
      await workflow.click();
      assert.equal((await submitted).postDataJSON().kind, "image");
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
