import { artifactPath } from "../support/artifacts.cjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fixture, password } from "../support/production.js";

test(
  "product requirements editor preserves drafts, isolates products, resets defaults and works on mobile",
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
      const defaults = (await f.workflows.repo.view()).common;
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
      const panel = page.locator(".product-requirements");
      await panel.getByText("默认要求", { exact: true }).waitFor();
      await panel
        .getByRole("button", { name: "编辑要求", exact: true })
        .click();
      const editor = page.locator("#product-requirements");
      const save = page.getByRole("button", {
        name: "保存当前产品要求",
        exact: true,
      });
      assert.equal(await editor.inputValue(), defaults);
      assert.equal(await save.isDisabled(), true);
      assert.equal(
        await editor.evaluate(
          (element: Element) => document.activeElement === element,
        ),
        true,
      );
      const custom = `${defaults}\n本产品要求：暖白背景，标题使用深棕色。`;
      await editor.fill(custom);
      await Promise.all([
        page.waitForResponse(
          (response: any) =>
            response.url().includes("/api/workspace/changes?") &&
            response.request().method() === "GET",
        ),
        page.evaluate(() =>
          document.dispatchEvent(new Event("visibilitychange")),
        ),
      ]);
      assert.equal(
        await editor.inputValue(),
        custom,
        "polling must preserve the unsaved draft",
      );
      await page.keyboard.press("Escape");
      await panel
        .getByRole("button", { name: "编辑要求", exact: true })
        .click();
      assert.equal(
        await editor.inputValue(),
        custom,
        "closing must retain the draft",
      );
      await editor.fill(custom);
      await save.click();
      await page.waitForFunction(
        () => !document.querySelector<HTMLDialogElement>("#modal")?.open,
      );
      await panel.getByText("本产品已自定义", { exact: true }).waitFor();
      let state = await f.workflows.repo.view();
      assert.equal(state.common, defaults);
      assert.equal(state.products[0].promptRequirements, custom);
      await page.reload();
      await panel.getByText("本产品已自定义", { exact: true }).waitFor();
      if (process.env.REQUIREMENTS_SCREENSHOTS) {
        await page.screenshot({
          path: artifactPath("requirements-workspace.png"),
        });
      }
      await panel
        .getByRole("button", { name: "生成整套提示词", exact: true })
        .click();
      await Promise.all([
        page.waitForResponse(
          (response: any) =>
            response.url().includes("/api/workspace/changes?") &&
            response.request().method() === "GET",
        ),
        page.evaluate(() =>
          document.dispatchEvent(new Event("visibilitychange")),
        ),
      ]);
      await panel
        .getByRole("button", { name: "编辑要求", exact: true })
        .click();
      await page
        .getByText("当前任务继续使用启动时的要求；修改用于下一次生成。")
        .waitFor();
      await editor.fill(`${custom}\n补充：保留更多留白。`);
      await page.selectOption("#requirement-template", "default");
      assert.equal(await editor.inputValue(), defaults);
      assert.equal(
        (await f.workflows.repo.view()).products[0].promptRequirements,
        custom,
      );
      await page.getByRole("button", { name: "撤销替换", exact: true }).click();
      assert.equal(
        await editor.inputValue(),
        `${custom}\n补充：保留更多留白。`,
      );
      if (process.env.REQUIREMENTS_SCREENSHOTS) {
        await page.screenshot({
          path: artifactPath("requirements-editor.png"),
        });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.equal(
        await page
          .locator("#modal")
          .evaluate(
            (element: HTMLElement) =>
              element.scrollWidth <= element.clientWidth,
          ),
        true,
      );
      if (process.env.REQUIREMENTS_SCREENSHOTS) {
        await page.screenshot({
          path: artifactPath("requirements-mobile.png"),
        });
      }
      await page.selectOption("#requirement-template", "");
      await page.selectOption("#requirement-template", "default");
      await save.click();
      await page.waitForFunction(
        () => !document.querySelector<HTMLDialogElement>("#modal")?.open,
      );
      await panel.getByText("默认要求", { exact: true }).waitFor();
      state = await f.workflows.repo.view();
      assert.equal(state.products[0].promptRequirements, null);
      assert.equal(
        state.jobs[0].common,
        custom,
        "editing requirements must not change an existing analysis job",
      );
      await page
        .getByRole("button", { name: "添加产品", exact: true })
        .filter({ visible: true })
        .click();
      await page.locator('#product-form [name="code"]').fill("SECOND");
      await page.locator('#product-form [name="name"]').fill("第二个产品");
      await page.getByRole("button", { name: "保存产品", exact: true }).click();
      await panel.getByText("默认要求", { exact: true }).waitFor();
      await panel
        .getByRole("button", { name: "编辑要求", exact: true })
        .click();
      assert.equal(
        await editor.inputValue(),
        defaults,
        "new products must inherit defaults",
      );
      await editor.fill("第二个产品独立要求：冷色背景。");
      await save.click();
      await page.waitForFunction(
        () => !document.querySelector<HTMLDialogElement>("#modal")?.open,
      );
      await page.selectOption("#mobile-product", f.product.id);
      await panel.getByText("默认要求", { exact: true }).waitFor();
      await panel
        .getByRole("button", { name: "编辑要求", exact: true })
        .click();
      assert.equal(await editor.inputValue(), defaults);
      state = await f.workflows.repo.view();
      assert.equal(state.common, defaults);
      assert.equal(
        state.products.find((product) => product.code === "SECOND")
          ?.promptRequirements,
        "第二个产品独立要求：冷色背景。",
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
