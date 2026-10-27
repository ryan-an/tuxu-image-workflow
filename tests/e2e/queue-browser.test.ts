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
import { newProduct, addVersion } from "../../shared/model.js";
import type { Product } from "../../server/production/types.js";

test(
  "product progress keeps the table, pages globally, filters without changing totals and loads details only on opening",
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
      await f.db.transaction(async (tx) => {
        await tx.query("DELETE FROM products");
        for (let i = 0; i < 65; i++) {
          const product = newProduct(
            `Q${String(i).padStart(3, "0")}`,
            `产品${i}`,
          ) as Product;
          if (i === 64) addVersion(product.tasks[0], f.product.photo, "ready");
          await f.workflows.repo.saveProduct(tx, product);
        }
      });
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
      });
      const errors: string[] = [];
      let fullReads = 0,
        detailReads = 0,
        submissions = 0;
      page.on("pageerror", (error: Error) => errors.push(error.message));
      page.on("request", (request: any) => {
        const url = new URL(request.url());
        if (url.pathname === "/api/workspace") fullReads++;
        if (url.pathname === "/api/workspace/products") detailReads++;
        if (url.pathname === "/api/jobs" && request.method() === "POST")
          submissions++;
      });
      await page.goto(root);
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      await page.locator(".task-card").first().waitFor();
      const baselineDetails = detailReads;
      await page.locator('[data-action="view"][data-view="queue"]').click();
      const rows = page.locator(
        ".batch-queue-table tbody tr[data-product-row]",
      );
      const pager = page.getByRole("navigation", { name: "产品进度分页" });
      await page.waitForFunction(
        () => document.querySelectorAll("tr[data-product-row]").length === 30,
      );
      const overview = page.getByRole("region", {
        name: "全局统计",
        exact: true,
      });
      assert.equal(await overview.locator(".queue-metric").count(), 4);
      await overview.getByText("有异常", { exact: true }).click();
      assert.equal(
        await page.getByRole("combobox", { name: "产品进度筛选" }).inputValue(),
        "attention",
      );
      await page.getByText("没有符合条件的产品", { exact: true }).waitFor();
      const attentionCard = page.getByRole("button", {
        name: "查看异常产品",
        exact: true,
      });
      assert.equal(await attentionCard.getAttribute("aria-pressed"), "true");
      assert.match(await attentionCard.innerText(), /已筛选/);
      const refreshed = page.waitForRequest(
        (request: any) =>
          request.url().includes("/api/queue/products?") &&
          new URL(request.url()).searchParams.get("status") === "attention",
      );
      await attentionCard.focus();
      await page.keyboard.press("Enter");
      await refreshed;
      await page
        .getByRole("combobox", { name: "产品进度筛选" })
        .selectOption("all");
      await page.waitForFunction(
        () => document.querySelectorAll("tr[data-product-row]").length === 30,
      );
      assert.equal(
        await overview.getByText("历史图片", { exact: true }).count(),
        0,
      );
      assert.equal(
        await page
          .getByRole("columnheader", { name: "历史图 / 已选", exact: true })
          .count(),
        0,
      );
      assert.match(
        await page.locator("#queue-complete").innerText(),
        /0\s*\/\s*65/,
      );
      await page
        .getByRole("button", { name: "查看图已齐的产品", exact: true })
        .click();
      await page.getByText("没有符合条件的产品", { exact: true }).waitFor();
      assert.equal(
        await page.getByRole("combobox", { name: "产品进度筛选" }).inputValue(),
        "complete",
      );
      await page
        .getByRole("combobox", { name: "产品进度筛选" })
        .selectOption("all");
      await page.waitForFunction(
        () => document.querySelectorAll("tr[data-product-row]").length === 30,
      );
      assert.ok(
        (await page
          .locator("#queue-generated")
          .evaluate((element: Element) =>
            parseFloat(getComputedStyle(element).fontSize),
          )) >= 24,
      );
      const overviewBox = await overview.boundingBox();
      assert.ok(
        overviewBox && overviewBox.height <= 150,
        "statistics stay in a compact desktop row",
      );
      const toolbar = page.getByRole("group", { name: "队列操作" });
      assert.equal(await toolbar.locator("button:visible").count(), 2);
      const toolbarBox = await toolbar.boundingBox();
      assert.ok(toolbarBox && toolbarBox.height <= 40);
      assert.equal(
        await page
          .locator("#queue-tab-products")
          .evaluate(
            (element: Element) => getComputedStyle(element).backgroundColor,
          ),
        "rgba(0, 0, 0, 0)",
      );
      const filterBox = await page
        .locator(".queue-product-filter")
        .boundingBox();
      assert.ok(filterBox && filterBox.height <= 40);
      const manager = page.getByRole("button", {
        name: "队列管理",
        exact: true,
      });
      const managerPanel = page.getByRole("dialog", { name: "全局队列管理" });
      assert.equal(await managerPanel.isVisible(), false);
      const tableTop = (await page
        .locator(".batch-queue-table-wrap")
        .boundingBox())!.y;
      await manager.focus();
      await page.keyboard.press("ArrowDown");
      await managerPanel.waitFor();
      await page.screenshot({
        path: artifactPath("queue-manager-desktop.png"),
      });
      assert.match(await managerPanel.innerText(), /作用于当前工作区全部任务/);
      assert.equal(
        await managerPanel.locator('[data-action="retry-failed"]').isDisabled(),
        true,
      );
      assert.ok(
        Math.abs(
          (await page.locator(".batch-queue-table-wrap").boundingBox())!.y -
            tableTop,
        ) < 1,
        "management opens without pushing the table down",
      );
      await page.keyboard.press("Escape");
      assert.equal(await managerPanel.isVisible(), false);
      await manager.click();
      await managerPanel.waitFor();
      await page
        .getByRole("heading", { name: "执行队列", exact: true })
        .click();
      assert.equal(await managerPanel.isVisible(), false);
      assert.equal(
        await page.locator('[data-action="generate-remaining"]').count(),
        0,
      );
      assert.equal(
        await page
          .getByRole("button", { name: /补齐缺图|批量生成剩余/ })
          .count(),
        0,
      );
      assert.match(
        await page.locator("#queue-generated").innerText(),
        /1\s*\/\s*650/,
      );
      assert.match(await pager.innerText(), /当前第 1 \/ 3 页/);
      assert.match(await rows.first().innerText(), /Q000/);
      await pager.getByRole("button", { name: "下一页" }).click();
      await page.waitForFunction(() =>
        document
          .querySelector("tr[data-product-row]")
          ?.textContent?.includes("Q030"),
      );
      assert.equal(await rows.count(), 30);
      await pager.getByRole("button", { name: "下一页" }).click();
      await page.waitForFunction(
        () => document.querySelectorAll("tr[data-product-row]").length === 5,
      );
      assert.match(await pager.innerText(), /当前第 3 \/ 3 页/);
      await page
        .getByRole("combobox", { name: "产品进度筛选" })
        .selectOption("ready");
      await page.waitForFunction(
        () => document.querySelectorAll("tr[data-product-row]").length === 1,
      );
      assert.match(await rows.first().innerText(), /Q064/);
      assert.match(await pager.innerText(), /当前第 1 \/ 1 页/);
      assert.match(
        await page.locator("#queue-generated").innerText(),
        /1\s*\/\s*650/,
      );
      await page.getByRole("tab", { name: /任务明细/ }).click();
      await page
        .getByText("尚无执行记录，可在图片工作台发起生成。", { exact: true })
        .waitFor();
      await page.getByRole("tab", { name: /产品进度/ }).click();
      assert.equal(
        await page.getByRole("combobox", { name: "产品进度筛选" }).inputValue(),
        "ready",
      );
      await page
        .getByRole("combobox", { name: "产品进度筛选" })
        .selectOption("all");
      await page.getByRole("textbox", { name: "搜索产品进度" }).fill("Q061");
      await page.waitForFunction(() =>
        document
          .querySelector("tr[data-product-row]")
          ?.textContent?.includes("Q061"),
      );
      assert.equal(await rows.count(), 1);
      assert.equal(detailReads, baselineDetails);
      assert.equal(fullReads, 0);
      await page
        .getByRole("heading", { name: "执行队列", exact: true })
        .click();
      await page
        .locator(".batch-queue")
        .screenshot({ path: artifactPath("queue-overview-redesign.png") });
      await page.screenshot({
        path: artifactPath("queue-product-progress-desktop.png"),
      });
      await page.setViewportSize({ width: 390, height: 1100 });
      assert.equal(
        await page
          .locator(".queue-product-filter")
          .evaluate(
            (element: Element) => element.scrollWidth > element.clientWidth + 1,
          ),
        false,
      );
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 1100 });
        for (const selector of [
          ".queue-overview",
          ".queue-nav-row",
          ".queue-product-filter",
        ])
          assert.equal(
            await page
              .locator(selector)
              .evaluate(
                (element: Element) =>
                  element.scrollWidth > element.clientWidth + 1,
              ),
            false,
            `${selector} fits at ${width}px`,
          );
        await manager.click();
        await managerPanel.waitFor();
        const box = (await managerPanel.boundingBox())!;
        assert.ok(
          box.x >= 0 &&
            box.x + box.width <= width &&
            box.y >= 0 &&
            box.y + box.height <= 1100,
        );
        if (width === 390)
          await page.screenshot({
            path: artifactPath("queue-manager-mobile.png"),
          });
        await page.keyboard.press("Escape");
      }
      await page.setViewportSize({ width: 390, height: 1100 });
      await page
        .getByRole("heading", { name: "执行队列", exact: true })
        .click();
      await page.screenshot({
        path: artifactPath("queue-product-progress-mobile.png"),
      });
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.route(
        "**/api/queue/products?**",
        (route: any) => route.abort(),
        { times: 1 },
      );
      await page
        .getByRole("textbox", { name: "搜索产品进度" })
        .fill("missing-product");
      await page.getByRole("button", { name: "重试加载产品进度" }).waitFor();
      await page.getByRole("button", { name: "重试加载产品进度" }).click();
      await page.getByText("没有符合条件的产品", { exact: true }).waitFor();
      assert.match(
        await page.locator("#queue-generated").innerText(),
        /1\s*\/\s*650/,
      );
      await page.getByRole("textbox", { name: "搜索产品进度" }).fill("Q061");
      await page.waitForFunction(() =>
        document
          .querySelector("tr[data-product-row]")
          ?.textContent?.includes("Q061"),
      );
      await rows.first().locator('[data-action="queue-open-product"]').click();
      await page
        .getByRole("heading", { name: "产品61", exact: true })
        .waitFor();
      assert.match(
        await page
          .getByRole("navigation", { name: "产品分页", exact: true })
          .innerText(),
        /第 3 \/ 3 页/,
      );
      assert.equal(detailReads, baselineDetails + 1);
      assert.equal(submissions, 0);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);

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
      await page.waitForFunction(() =>
        document
          .getElementById("queue-attention")
          ?.textContent?.trim()
          .startsWith("1"),
      );
      await page
        .getByRole("textbox", { name: "搜索产品进度" })
        .fill("不存在的产品");
      await page.getByText("没有符合条件的产品", { exact: true }).waitFor();
      await page.locator("#queue-attention").click();
      assert.equal(
        await page.getByRole("combobox", { name: "产品进度筛选" }).inputValue(),
        "attention",
      );
      assert.equal(
        await page.getByRole("textbox", { name: "搜索产品进度" }).inputValue(),
        "",
      );
      assert.equal(
        await page
          .getByRole("button", { name: "查看异常产品" })
          .getAttribute("aria-pressed"),
        "true",
      );
      await page.waitForFunction(
        () => document.querySelectorAll("tr[data-product-row]").length === 1,
      );
      await page.getByRole("tab", { name: /任务明细/ }).click();
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
      await page.waitForFunction(
        () => document.querySelectorAll(".queue-row").length === 2,
      );
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
      assert.equal(await page.locator("#concurrency").isVisible(), false);
      await page.getByRole("button", { name: "队列管理", exact: true }).click();
      assert.equal(await page.locator("#concurrency").count(), 0);
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
      await page.keyboard.press("Escape");
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
      await page.getByRole("button", { name: "队列管理", exact: true }).click();
      await page.locator('[data-action="pause-queue"]').click();
      await page
        .locator(".queue-overview-heading .ui-badge")
        .filter({ hasText: "队列已暂停" })
        .waitFor();
      await page.getByRole("button", { name: "队列管理", exact: true }).click();
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
