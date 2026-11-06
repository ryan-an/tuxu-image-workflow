import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fixture, password, pairs } from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";
import { Members } from "../../server/production/members.js";

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

test(
  "collaborators see the same image task, duplicate submission details and recovery controls",
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
          value: "原提示词",
        },
      ]);
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const pages: any[] = [];
      const errors: string[] = [];
      for (const [username, displayName] of [
        ["image-a", "协作者甲"],
        ["image-b", "协作者乙"],
      ]) {
        await new Members(f.db).create({
          username,
          displayName,
          password,
          role: "editor",
          monthlyLimit: null,
        });
        const context = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
        });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        page.on("pageerror", (error: Error) => errors.push(error.message));
        pages.push(page);
        await page.goto(root);
        await page.fill("#login-username", username);
        await page.fill("#login-password", password);
        await page.click('#login-form button[type="submit"]');
        await page
          .locator(".task-card")
          .first()
          .locator(".prompt-preview-text")
          .click();
      }
      const [a, b] = pages;
      const first = a.locator(".task-card").first();
      const second = b.locator(".task-card").first();
      await first
        .locator(".inline-prompt-form textarea")
        .fill("甲提交的提示词");
      await second
        .locator(".inline-prompt-form textarea")
        .fill("乙编辑的提示词");
      await first
        .getByRole("button", { name: "保存并重新生成", exact: true })
        .click();
      await first
        .locator(".generation-progress strong")
        .getByText("等待生成", { exact: true })
        .waitFor();
      async function update(
        status: "queued" | "interrupted",
        remoteId?: string,
      ) {
        await f.db.transaction(async (tx) => {
          const jobs = (await f.workflows.repo.view(tx)).jobs;
          assert.equal(jobs.length, 1);
          const job = jobs[0];
          job.status = status;
          job.remoteId = remoteId;
          job.stage = remoteId ? "polling" : "submitting";
          job.progress = 46;
          await f.workflows.repo.saveJob(tx, job);
        });
      }
      await update("queued", "shared-platform-task");
      for (const card of [first, second]) {
        await card
          .locator(".generation-percent")
          .getByText("46%", { exact: true })
          .waitFor();
        assert.equal(
          await card.locator(".generation-submitter").innerText(),
          "提交人：协作者甲",
        );
        assert.equal(
          await card.locator('[data-action="generate-image"]').isDisabled(),
          true,
        );
      }
      await second
        .getByRole("button", { name: "保存并重新生成", exact: true })
        .click();
      await second
        .getByText(/已有生图任务：正在生成图片 46%.*协作者甲/)
        .waitFor();
      const state = await f.workflows.repo.view();
      assert.equal(state.jobs.length, 1);
      assert.equal(state.jobs[0].prompt, "甲提交的提示词");
      assert.equal(state.products[0].tasks[0].prompt, "乙编辑的提示词");
      await update("interrupted", "shared-platform-task");
      await second
        .getByRole("button", { name: "继续查询", exact: true })
        .waitFor();
      assert.equal(await second.getByRole("progressbar").count(), 0);
      assert.equal(
        await second.locator(".generation-progress").getAttribute("aria-busy"),
        "false",
      );
      await second
        .getByRole("button", { name: "继续查询", exact: true })
        .click();
      await second
        .locator(".generation-percent")
        .getByText("46%", { exact: true })
        .waitFor();
      assert.equal((await f.workflows.repo.view()).jobs.length, 1);
      await update("interrupted");
      await second
        .getByRole("button", { name: "核对平台", exact: true })
        .waitFor();
      await b.setViewportSize({ width: 390, height: 844 });
      await second.locator(".generation-progress").scrollIntoViewIfNeeded();
      await b.screenshot({
        path: artifactPath("image-job-recovery-mobile.png"),
        fullPage: true,
      });
      assert.equal(
        await b.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await second
        .getByRole("button", { name: "核对平台", exact: true })
        .click();
      await b
        .getByRole("heading", { name: "核对平台任务", exact: true })
        .waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
