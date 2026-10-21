import { artifactPath } from "../support/artifacts.cjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  fixture,
  password,
  pairs,
  fakeProvider,
  counts,
} from "../support/production.js";
import { Worker } from "../../server/production/worker.js";

test(
  "queue exception cards keep long messages, statuses and actions readable across viewport sizes",
  {
    skip: !process.env.PLAYWRIGHT_MODULE,
    timeout: 45000,
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
      await f.db.transaction(async (tx) => {
        const state = await f.workflows.repo.view(tx);
        const variants = [
          {
            status: "failed" as const,
            stage: "pending",
            role: "场景图",
            error:
              "图片生成失败：平台暂时繁忙，请稍后重试。错误代码：PROVIDER_RATE_LIMIT_EXCEEDED_REQUEST_RETRY_AFTER_30_SECONDS。",
          },
          {
            status: "interrupted" as const,
            stage: "submitting",
            role: "卖点图",
            error:
              "请求中断，平台受理状态未知。请核对平台后填写原任务 ID，或确认未受理后再重新提交。",
          },
          {
            status: "queued" as const,
            stage: "polling",
            role: "主图",
            remoteId: "grsai-20261021-8f96a37a-9209-482a-8cf4-482030a95ddd",
            progress: 46,
          },
          { status: "queued" as const, stage: "pending", role: "细节图" },
          { status: "completed" as const, stage: "completed", role: "尺寸图" },
          {
            status: "cancelled" as const,
            stage: "pending",
            role: "包装图",
            error: "已取消，尚未提交平台",
          },
        ];
        for (const [index, variant] of variants.entries())
          await f.workflows.repo.insertJob(tx, {
            id: randomUUID(),
            productId: f.product.id,
            taskId: f.product.tasks[index].id,
            productName:
              index === 0
                ? "Blcculi 牛皮纸信封 · 25个装 · 亚马逊主图与场景展示"
                : "Blcculi 牛皮纸信封",
            kind: "image",
            mode: "live",
            config: state.settings,
            createdAt: Date.now() + index,
            error: "",
            ...variant,
          });
      });
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
      });
      await page.goto(
        `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`,
      );
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      await page.locator('[data-action="view"][data-view="queue"]').click();
      await page.getByRole("region", { name: "异常任务提醒" }).waitFor();
      await page.getByRole("button", { name: "查看异常任务" }).click();
      assert.equal(
        await page
          .getByRole("tab", { name: /任务明细/ })
          .getAttribute("aria-selected"),
        "true",
      );
      assert.equal(
        await page.getByRole("combobox", { name: "任务状态" }).inputValue(),
        "attention",
      );
      await page.waitForFunction(() => document.querySelectorAll(".queue-row").length === 2);
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 1100 });
        for (const selector of [".queue-attention", ".queue-row"]) {
          const overflow = await page
            .locator(selector)
            .evaluateAll((elements: Element[]) =>
              elements.some(
                (element) => element.scrollWidth > element.clientWidth + 1,
              ),
            );
          assert.equal(overflow, false, `${selector} must wrap at ${width}px`);
        }
        assert.equal(
          await page.locator(".batch-queue [data-action]").count(),
          0,
          "records view has no execution actions",
        );
        assert.equal(await page.locator("#concurrency").count(), 0);
        if (process.env.QUEUE_SCREENSHOT)
          await page.screenshot({
            path: artifactPath(`queue-appearance-${width}.png`),
          });
        if (process.env.QUEUE_SCREENSHOT && width === 390) {
          await page.locator(".queue-row").first().scrollIntoViewIfNeeded();
          await page.screenshot({ path: artifactPath("queue-cards-390.png") });
        }
      }
      await page
        .getByRole("combobox", { name: "任务状态" })
        .selectOption("all");
      await page.waitForFunction(
        () => document.querySelectorAll(".queue-row").length === 6,
      );
      assert.equal(
        await page
          .getByRole("progressbar", { name: "图片生成进度" })
          .getAttribute("aria-valuenow"),
        "46",
      );
      assert.equal(
        await page.locator(".queue-card--cancelled .is-error").count(),
        0,
      );
      await f.db.transaction(async (tx) => {
        for (const job of (await f.workflows.repo.view(tx)).jobs.filter(
          (job) => job.status === "queued",
        )) {
          job.status = "completed";
          await f.workflows.repo.saveJob(tx, job);
        }
      });
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.getByRole("tab", { name: /产品进度/ }).click();
      assert.equal(await page.locator("#concurrency").isVisible(), true);
      await page.locator(".queue-product-state .status-badge.error").waitFor();
      assert.equal(
        await page
          .locator('.queue-product-state [data-action="retry-product-failed"]')
          .isVisible(),
        true,
      );
      assert.equal(
        await page
          .locator(
            '.queue-product-row-actions [data-action="retry-product-failed"]',
          )
          .count(),
        0,
      );
      assert.equal(
        await page.locator('[data-action="retry-failed"]').isVisible(),
        true,
      );
      assert.equal(
        await page.getByText("产品执行管理", { exact: true }).count(),
        0,
      );
      assert.equal(
        await page.getByRole("button", { name: /管理任务|收起操作/ }).count(),
        0,
      );
      const toolbarBox = await page
        .locator(".queue-product-toolbar")
        .boundingBox();
      assert.ok(
        toolbarBox && toolbarBox.height <= 64,
        "desktop controls fit in a compact single row",
      );
      assert.equal(
        await page.locator(".batch-queue-table tbody tr").count(),
        1,
      );
      await page.locator('[data-action="reconcile-job"]').click();
      await page.getByRole("heading", { name: "核对平台任务" }).waitFor();
      await page.keyboard.press("Escape");
      if (process.env.QUEUE_SCREENSHOT)
        await page.screenshot({
          path: artifactPath("queue-product-controls.png"),
        });
      await page.setViewportSize({ width: 390, height: 1100 });
      assert.equal(
        await page
          .locator(".queue-product-toolbar")
          .evaluate(
            (element: Element) => element.scrollWidth > element.clientWidth + 1,
          ),
        false,
      );
      if (process.env.QUEUE_SCREENSHOT) {
        await page.locator(".queue-product-toolbar").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: artifactPath("queue-product-controls-mobile.png"),
        });
      }
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.locator('[data-action="retry-product-failed"]').click();
      await page.waitForFunction(
        () => !document.querySelector('[data-action="retry-product-failed"]'),
      );
      const recovered = (await f.workflows.repo.view()).jobs.find(
        (job) => job.role === "场景图",
      );
      assert.equal(recovered?.status, "queued");
    } finally {
      await browser.close();
      await f.close();
    }
  },
);

test(
  "queue shows platform work, filters history, loads more and cancels only unsubmitted jobs",
  {
    skip: !process.env.PLAYWRIGHT_MODULE,
    timeout: 45000,
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
      await f.workflows.enqueue(randomUUID(), pairs(f.product), "workflow");
      const worker = new Worker(f.workflows, fakeProvider(counts()));
      await worker.step();
      await worker.step();
      await f.db.transaction(async (tx) => {
        const state = await f.workflows.repo.view(tx);
        for (let i = 0; i < 60; i++)
          await f.workflows.repo.insertJob(tx, {
            ...state.jobs[1],
            id: randomUUID(),
            status: "completed",
            stage: "completed",
            remoteId: undefined,
            createdAt: Date.now() + i,
            role: `历史卡片 ${i}`,
            dependsOn: undefined,
          });
      });
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(
        `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`,
      );
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      await page.locator('[data-action="view"][data-view="queue"]').click();
      await page.getByRole("heading", { name: "执行队列" }).waitFor();
      const productTab = page.getByRole("tab", { name: /产品进度/ });
      const jobTab = page.getByRole("tab", { name: /任务明细/ });
      assert.equal(await productTab.getAttribute("aria-selected"), "true");
      assert.equal(
        await page.locator(".batch-queue-table-wrap").isVisible(),
        true,
      );
      assert.equal(await page.locator(".queue-job-details").count(), 0);
      await jobTab.click();
      assert.equal(await page.locator(".batch-queue-table-wrap").count(), 0);
      assert.equal(await page.locator(".queue-job-details").isVisible(), true);
      await page.waitForFunction(
        () => document.querySelectorAll(".queue-row").length === 50,
      );
      const rowsBefore = await page
        .locator(".queue-row")
        .evaluateAll((nodes: Element[]) =>
          nodes.map((node) => node.getAttribute("data-job")),
        );
      const pageRequest = page.waitForRequest(
        (request: any) =>
          request.url().includes("/api/jobs/history?") &&
          new URL(request.url()).searchParams.get("page") === "2",
      );
      await page.getByRole("button", { name: "下一页", exact: true }).click();
      await pageRequest;
      await page.waitForFunction(
        () => document.querySelectorAll(".queue-row").length === 21,
      );
      const rowsAfter = await page
        .locator(".queue-row")
        .evaluateAll((nodes: Element[]) =>
          nodes.map((node) => node.getAttribute("data-job")),
        );
      assert.ok(rowsAfter.every((id: string) => !rowsBefore.includes(id)));
      await page
        .getByRole("combobox", { name: "任务状态" })
        .selectOption("active");
      await page.waitForFunction(
        () => document.querySelectorAll(".queue-row").length === 10,
      );
      assert.equal(
        await page.locator(".queue-row .queue-status.running").count(),
        1,
      );
      await page
        .getByRole("textbox", { name: "搜索队列任务" })
        .fill("remote-1");
      await page.waitForFunction(
        () => document.querySelectorAll(".queue-row").length === 1,
      );
      await page.getByRole("textbox", { name: "搜索队列任务" }).fill("");
      assert.equal(await page.locator(".batch-queue [data-action]").count(), 0);
      await productTab.click();
      await page.locator("#concurrency").selectOption("3");
      await page.locator('[data-action="pause-queue"]').click();
      await page
        .getByRole("button", { name: "继续队列", exact: true })
        .waitFor();
      await page.locator('[data-action="cancel-pending"]').click();
      await jobTab.click();
      await page.waitForFunction(
        () => document.querySelectorAll(".queue-row").length === 1,
      );
      assert.equal(await page.locator(".queue-status.running").count(), 1);
      const state = await f.workflows.repo.view();
      assert.equal(
        state.jobs.filter((j) => j.status === "cancelled").length,
        9,
      );
      await page
        .getByRole("combobox", { name: "任务状态" })
        .selectOption("all");
      if (process.env.QUEUE_SCREENSHOT)
        await page.screenshot({
          path: resolve(process.env.QUEUE_SCREENSHOT),
          fullPage: true,
        });
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .getByRole("textbox", { name: "搜索队列任务" })
        .fill("不存在的任务");
      await page.getByText("没有符合条件的任务", { exact: true }).waitFor();
      await productTab.click();
      assert.equal(
        await page.locator(".batch-queue-table-wrap").isVisible(),
        true,
      );
      assert.equal(await page.locator(".queue-job-details").count(), 0);
      await jobTab.click();
      assert.equal(
        await page.getByRole("textbox", { name: "搜索队列任务" }).inputValue(),
        "不存在的任务",
      );
      await jobTab.focus();
      await page.keyboard.press("ArrowLeft");
      assert.equal(await productTab.getAttribute("aria-selected"), "true");
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
