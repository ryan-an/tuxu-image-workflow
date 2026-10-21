import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fixture, password } from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";

test(
  "settings button reports saved API keys after save, clear and reload at desktop and mobile widths",
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
      await f.workflows.updateSettings({
        clearKey: true,
        clearPromptKey: true,
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
      const button = page.locator("#settings-button");
      const status = button.locator(".settings-key-status");
      const checkStatus = async (text: string, configured = false) => {
        await status.getByText(text, { exact: true }).waitFor();
        assert.equal(
          await status.getAttribute("data-badge-tone"),
          configured ? "success" : "danger",
        );
        for (const width of [1440, 1024, 780, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          assert.equal(await status.isVisible(), true, `status at ${width}px`);
          const dot = await status
            .locator(".settings-key-dot")
            .evaluate((element: Element) => {
              const style = getComputedStyle(element);
              const bounds = element.getBoundingClientRect();
              return {
                background: style.backgroundColor,
                color: style.color,
                radius: style.borderRadius,
                width: bounds.width,
                height: bounds.height,
              };
            });
          assert.equal(dot.background, dot.color);
          assert.equal(
            dot.color,
            configured ? "rgb(20, 122, 66)" : "rgb(201, 47, 70)",
          );
          assert.equal(dot.radius, "50%");
          assert.ok(dot.width > 0);
          assert.equal(dot.width, dot.height);
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            true,
            `page must not overflow at ${width}px`,
          );
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
      };
      const save = async () => {
        await page.locator('#settings-form button[type="submit"]').click();
        await page.locator("#settings-form").waitFor({ state: "detached" });
      };

      await checkStatus("未设置豆包、Grsai API Key");
      await button.click();
      await page.fill('[name="promptApiKey"]', "unsaved-doubao-key");
      await page.keyboard.press("Escape");
      await checkStatus("未设置豆包、Grsai API Key");

      await button.click();
      await page.fill('[name="promptApiKey"]', "saved-doubao-key");
      await save();
      await checkStatus("未设置Grsai API Key");
      await page.reload();
      await checkStatus("未设置Grsai API Key");

      await button.click();
      await page.fill('[name="apiKey"]', "saved-grsai-key");
      await save();
      await checkStatus("已填 API Key", true);
      await page
        .locator("#save-status")
        .getByText("已保存数据", { exact: true })
        .waitFor();
      assert.equal(
        await page.locator("#save-status .save-status-dot").isVisible(),
        true,
      );
      assert.equal(
        await page
          .locator(".save-status-dot")
          .evaluate(
            (element: Element) => getComputedStyle(element).backgroundColor,
          ),
        "rgb(20, 122, 66)",
      );
      await page.screenshot({
        path: artifactPath("settings-keys-configured.png"),
      });

      await button.click();
      await page
        .getByRole("button", { name: "清除豆包密钥", exact: true })
        .click();
      await page
        .getByRole("button", { name: "清除豆包密钥", exact: true })
        .waitFor({ state: "detached" });
      await page.keyboard.press("Escape");
      await checkStatus("未设置豆包 API Key");
      await page.screenshot({
        path: artifactPath("settings-doubao-key-missing.png"),
      });

      await button.click();
      await page
        .getByRole("button", { name: "清除生图密钥", exact: true })
        .click();
      await page
        .getByRole("button", { name: "清除生图密钥", exact: true })
        .waitFor({ state: "detached" });
      await page.keyboard.press("Escape");
      await checkStatus("未设置豆包、Grsai API Key");
      await page.reload();
      await checkStatus("未设置豆包、Grsai API Key");
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
