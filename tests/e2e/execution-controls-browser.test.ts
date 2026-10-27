import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  fixture,
  password,
  fakeProvider,
  counts,
} from "../support/production.js";
import { Worker } from "../../server/production/worker.js";
import { artifactPath } from "../support/artifacts.cjs";

test(
  "queue has no concurrency controls and analysis phases stay visible without timing details",
  { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 60000 },
  async () => {
    const { chromium } = createRequire(import.meta.url)(
      process.env.PLAYWRIGHT_MODULE!,
    );
    const f = await fixture(resolve("dist"));
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
    });
    let releasePrepare!: () => void,
      releaseFirst!: () => void,
      releaseComplete!: () => void;
    const prepare = new Promise<void>((r) => {
      releasePrepare = r;
    });
    const first = new Promise<void>((r) => {
      releaseFirst = r;
    });
    const complete = new Promise<void>((r) => {
      releaseComplete = r;
    });
    let running: Promise<boolean> | undefined;
    try {
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as any).port}`;
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const assertNoTimingDetails = async () => {
        assert.equal(await page.locator(".analysis-timing").count(), 0);
        assert.equal(
          await page.getByText(/(?:排队|图片准备|请求至首段|文本生成)\s+\d/).count(),
          0,
        );
      };
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(root);
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      await page.locator('[data-action="view"][data-view="queue"]').click();
      await page.getByRole("button", { name: "队列管理", exact: true }).click();
      assert.equal(
        await page
          .locator("#promptConcurrency, #concurrency, #queryConcurrency")
          .count(),
        0,
      );
      assert.equal(await page.locator(".queue-execution-limits").count(), 0);
      await page.screenshot({
        path: artifactPath("execution-queue-controls.png"),
      });
      await page.keyboard.press("Escape");
      await page.locator('[data-action="view"][data-view="workbench"]').click();
      await page.locator('[data-action="generate-prompt"]').first().click();
      const provider = fakeProvider(counts()),
        analyze = provider.analyze;
      provider.analyze = async (...args) => {
        const phase = args[6];
        await phase?.({ phase: "preparing", at: Date.now() });
        await prepare;
        await phase?.({
          phase: "requesting",
          at: Date.now(),
          imageCount: 1,
          imageBytes: 1000,
        });
        await first;
        await phase?.({ phase: "streaming", at: Date.now() });
        await complete;
        return analyze(...args);
      };
      // Wait for the browser's enqueue command to commit before dispatch.
      for (
        let n = 0;
        n < 100 && !(await f.workflows.repo.view()).jobs.length;
        n++
      )
        await new Promise((r) => setTimeout(r, 20));
      running = new Worker(f.workflows, provider, () => {}).step("prompt");
      await page
        .getByText("正在准备分析图片", { exact: true })
        .first()
        .waitFor();
      await assertNoTimingDetails();
      releasePrepare();
      await page.getByText("等待平台响应", { exact: true }).first().waitFor();
      releaseFirst();
      await page.getByText("正在编写提示词", { exact: true }).first().waitFor();
      await assertNoTimingDetails();
      releaseComplete();
      await running;
      await page
        .getByText("提示词已就绪", { exact: true })
        .first()
        .waitFor();
      await assertNoTimingDetails();
      await page.locator('[data-action="view"][data-view="queue"]').click();
      await page.getByRole("tab", { name: /任务明细/ }).click();
      await page.locator(".queue-row").first().waitFor();
      await assertNoTimingDetails();
      assert.deepEqual(errors, []);
    } finally {
      releasePrepare();
      releaseFirst();
      releaseComplete();
      await running?.catch(() => {});
      await browser.close();
      await f.close();
    }
  },
);
