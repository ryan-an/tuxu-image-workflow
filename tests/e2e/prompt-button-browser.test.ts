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
  "suite buttons show a spinner and cancel queued or running analysis, ready prompts have green dots",
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
    let work: Promise<boolean> | undefined;
    try {
      await f.workflows.edit(
        f.product.tasks.map((task) => ({
          path: ["products", f.product.id, "tasks", task.id, "prompt"],
          before: "",
          value: "已有提示词",
        })),
      );
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      page.setDefaultTimeout(7000);
      await page.goto(
        `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`,
      );
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      const idle = page.getByRole("button", {
        name: "生成整套提示词",
        exact: true,
      });
      await idle.first().waitFor();
      assert.equal(
        await page
          .locator(".prompt-preview.is-ready .prompt-state-dot")
          .first()
          .evaluate((node: Element) => getComputedStyle(node).backgroundColor),
        "rgb(66, 170, 131)",
      );
      await idle.first().click();
      const stop = page.getByRole("button", {
        name: "生成整套提示词中，点击终止",
        exact: true,
      });
      await stop.first().waitFor();
      assert.equal(await stop.count(), 1);
      assert.equal(
        await page
          .locator("[data-action='cancel-product-analysis'] .status-spinner")
          .count(),
        1,
      );
      assert.equal(
        await page
          .getByRole("button", { name: /^(取消分析|终止分析)$/ })
          .count(),
        0,
      );
      await stop.last().click();
      await idle.first().waitFor();
      assert.ok(
        (await f.workflows.repo.view()).jobs.every(
          (job) => job.status === "cancelled",
        ),
      );
      await idle.last().click();
      await stop.first().waitFor();
      let started!: () => void;
      const startedSignal = new Promise<void>((done) => {
        started = done;
      });
      const provider = fakeProvider(counts());
      provider.analyze = async (_product, _common, _config, _key, signal) => {
        started();
        return new Promise((_done, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
      };
      work = new Worker(f.workflows, provider, () => {}).step();
      await startedSignal;
      await page.reload();
      await stop.first().waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: artifactPath("prompt-button-running.png"),
        fullPage: true,
      });
      await stop.first().click();
      await idle.first().waitFor();
      await work;
      assert.ok(
        (await f.workflows.repo.view()).jobs.every(
          (job) => job.status === "cancelled",
        ),
      );
    } finally {
      if (work) {
        for (const job of (await f.workflows.repo.view()).jobs.filter(
          (job) => job.status === "running",
        ))
          await f.workflows.control(job.id, "cancel");
        await work;
      }
      await browser.close();
      await f.close();
    }
  },
);
