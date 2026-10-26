import { artifactPath } from "../support/artifacts.cjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Worker } from "../../server/production/worker.js";
import {
  fixture,
  password,
  fakeProvider,
  counts,
  pairs,
} from "../support/production.js";

test(
  "new generation is checked by default and unchecking updates card, sidebar, filters and queue status",
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
      const worker = new Worker(f.workflows, fakeProvider(counts()));
      const generate = async () => {
        await f.workflows.enqueue(
          randomUUID(),
          pairs(f.product).slice(0, 1),
          "workflow",
        );
        for (let step = 0; step < 3; step++) {
          await f.due();
          await worker.step();
        }
      };
      await generate();
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      await page.goto(
        `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`,
      );
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      const card = page.locator(".task-card").first();
      await card.locator(".status-badge.done").waitFor();
      assert.equal(
        await card.locator('[data-action="select-version"]').isChecked(),
        true,
      );
      await page.locator('[data-action="view"][data-view="queue"]').click();
      const row = page.locator(`[data-product-row="${f.product.id}"]`);
      await row.locator(".status-badge.partial").waitFor();
      const sidebarStatus = page
        .locator(".product-completion .status-badge")
        .first();
      assert.equal((await sidebarStatus.textContent()).trim(), "部分完成");
      assert.equal(
        await sidebarStatus.getAttribute("data-badge-tone"),
        "warning",
      );
      assert.equal(
        await row
          .locator(".status-badge")
          .evaluate((element: Element) => getComputedStyle(element).color),
        "rgb(148, 91, 6)",
      );
      assert.equal(
        (await row.locator(".status-badge").textContent()).trim(),
        "部分完成",
      );
      await page.locator('[data-action="view"][data-view="workbench"]').click();
      const checkbox = card.locator('[data-action="select-version"]');
      const saved = page.waitForResponse(
        (response: any) =>
          response.url().endsWith("/api/workspace") &&
          response.request().method() === "PATCH",
      );
      await checkbox.uncheck();
      await saved;
      await card.locator(".status-badge.ready").waitFor();
      assert.equal((await sidebarStatus.textContent()).trim(), "待选图");
      assert.equal(
        await card
          .locator(".status-badge")
          .evaluate((element: Element) => getComputedStyle(element).color),
        "rgb(36, 94, 219)",
      );
      assert.equal(
        (await card.locator(".status-badge").textContent()).trim(),
        "待选图",
      );
      assert.match(
        await page.locator(".product-completion").first().textContent(),
        /0\s*\/\s*10/,
      );
      await page
        .locator('[data-action="filter-tasks"][data-filter="selected"]')
        .click();
      assert.equal(await page.locator(".task-card").count(), 0);
      await page.locator('[data-action="view"][data-view="queue"]').click();
      await row.locator(".status-badge.ready").waitFor();
      assert.equal(
        (await row.locator(".status-badge").textContent()).trim(),
        "待选图",
      );
      const before = (await f.workflows.repo.view()).products[0].tasks[0];
      const previous = before.versions[0].id;
      await generate();
      await page.locator('[data-action="view"][data-view="workbench"]').click();
      await page
        .getByRole("button", { name: "全部", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document.querySelectorAll(
            '.task-card:first-child [data-action="select-version"]',
          ).length === 2,
      );
      const after = (await f.workflows.repo.view()).products[0].tasks[0];
      const latest = after.versions[1].id;
      assert.equal(after.primaryId, latest);
      assert.deepEqual(after.selectedIds, [latest]);
      assert.equal(
        await card
          .locator(`[data-version="${latest}"][data-action="select-version"]`)
          .isChecked(),
        true,
      );
      assert.equal(
        await card
          .locator(`[data-version="${previous}"][data-action="select-version"]`)
          .isChecked(),
        false,
      );
      await card.locator(".status-badge.done").waitFor();
      if (process.env.QUEUE_SCREENSHOT)
        await page.screenshot({
          path: artifactPath("selection-latest-preview.png"),
        });
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
