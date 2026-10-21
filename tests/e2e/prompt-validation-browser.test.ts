import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Worker } from "../../server/production/worker.js";
import { ProviderError } from "../../server/production/provider.js";
import {
  fixture,
  password,
  pairs,
  counts,
  fakeProvider,
} from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";

test(
  "content warnings are absent from completed cards and queue while structural failures remain visible",
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
      await f.workflows.enqueue(
        randomUUID(),
        pairs(f.product).slice(0, 1),
        "prompt",
      );
      const provider = fakeProvider(counts()),
        analyze = provider.analyze.bind(provider);
      const warning =
        "尺寸图文案共13词，不在当前5–10词范围内，请检查文案。提示词已保存。";
      provider.analyze = async (...args) => ({
        ...(await analyze(...args)),
        warnings: [
          {
            code: "copy_word_count",
            role: "尺寸图",
            actual: 13,
            min: 5,
            max: 10,
            message: warning,
          },
        ],
      });
      const worker = new Worker(f.workflows, provider, () => {});
      await worker.step();
      await f.workflows.enqueue(
        randomUUID(),
        pairs(f.product).slice(1, 2),
        "prompt",
      );
      provider.analyze = async () => {
        const error = new ProviderError(
          "整套提示词角色、布局或英文文案不完整，请重试",
          false,
          true,
        );
        error.validation = { code: "invalid_card", role: "卖点图" };
        throw error;
      };
      await worker.step();
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
      const ready = page.locator(".task-card").nth(0),
        failed = page.locator(".task-card").nth(1);
      await ready.getByText("提示词已就绪", { exact: true }).waitFor();
      assert.equal(
        await ready.locator(".prompt-validation-message").count(),
        0,
      );
      assert.equal(await ready.locator(".status-badge").innerText(), "待生图");
      assert.equal(
        await ready
          .getByRole("button", { name: "生成图片", exact: true })
          .isEnabled(),
        true,
      );
      await failed.getByText("提示词校验未通过", { exact: true }).waitFor();
      assert.match(
        await failed.getByRole("alert").innerText(),
        /角色、布局或英文文案不完整/,
      );
      assert.equal(await page.locator(".prompt-error-title").count(), 1);
      await page.screenshot({
        path: artifactPath("prompt-validation.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.click('[data-action="view"][data-view="queue"]');
      await page.getByRole("tab", { name: /任务明细/ }).click();
      assert.equal(
        await page
          .getByRole("tabpanel", { name: /任务明细/ })
          .getByText(warning, { exact: true })
          .count(),
        0,
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
