import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fixture, password, pairs } from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";

test(
  "result placeholder shows real image progress, regeneration overlay and completion on mobile",
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
      await f.workflows.edit([
        {
          path: [
            "products",
            f.product.id,
            "tasks",
            f.product.tasks[0].id,
            "prompt",
          ],
          before: "",
          value: "图片提示词",
        },
      ]);
      await f.workflows.enqueue(
        randomUUID(),
        pairs(f.product).slice(0, 1),
        "image",
      );
      async function update(
        status: string,
        remoteId?: string,
        progress?: number,
        withImage = false,
      ) {
        await f.db.transaction(async (tx) => {
          const state = await f.workflows.repo.view(tx),
            job = state.jobs[0];
          job.status = status as any;
          job.remoteId = remoteId;
          job.progress = progress;
          await f.workflows.repo.saveJob(tx, job);
          if (withImage) {
            const product = state.products[0],
              task = product.tasks[0];
            task.versions = [
              {
                id: "previous",
                number: 1,
                source: product.photo,
                prompt: task.prompt,
                origin: "generated",
                createdAt: Date.now(),
              },
            ];
            task.primaryId = "previous";
            task.selectedIds = ["previous"];
            await f.workflows.repo.saveProduct(tx, product);
          }
        });
      }
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      page.setDefaultTimeout(6000);
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(
        `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`,
      );
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      const card = page.locator(".task-card").first(),
        bar = card.getByRole("progressbar", { name: "图片生成进度" });
      await card
        .locator(".generation-progress strong")
        .getByText("等待生成", { exact: true })
        .waitFor();
      assert.equal(await bar.getAttribute("aria-valuenow"), null);
      await update("running");
      await page.reload();
      await card
        .locator(".generation-progress strong")
        .getByText("正在提交图片", { exact: true })
        .waitFor();
      await update("queued", "remote", 46);
      await page.reload();
      await card
        .locator(".generation-percent")
        .getByText("46", { exact: false })
        .waitFor();
      assert.equal(await bar.getAttribute("aria-valuenow"), "46");
      await page.screenshot({
        path: artifactPath("image-generation-progress.png"),
        fullPage: true,
      });
      await update("queued", "remote", 73, true);
      await page.reload();
      await card.locator(".generation-progress.is-overlay").waitFor();
      assert.equal(await bar.getAttribute("aria-valuenow"), "73");
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: artifactPath("image-generation-progress-mobile.png"),
        fullPage: true,
      });
      await update("completed", "remote", 100);
      await page.reload();
      await card.locator(".result-image").waitFor();
      assert.equal(await card.locator(".generation-progress").count(), 0);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
