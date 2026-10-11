import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import {
  fixture,
  fakeProvider,
  counts,
  password,
  png,
} from "./test-support.js";
import { Worker } from "./worker.js";
test(
  "production browser saves, submits, closes and reloads durable results and portable backup",
  { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 60000 },
  async () => {
    const { chromium } = createRequire(import.meta.url)(
      process.env.PLAYWRIGHT_MODULE!,
    );
    const f = await fixture(resolve("dist"));
    const browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROME_PATH
        ? { executablePath: process.env.CHROME_PATH }
        : {}),
    });
    try {
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const address = f.app.server.address() as { port: number },
        root = `http://127.0.0.1:${address.port}`;
      const context = await browser.newContext({
        httpCredentials: { username: "admin", password },
        acceptDownloads: true,
      });
      const page = await context.newPage(),
        errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(e.message));
      await page.goto(root);
      await page
        .waitForSelector(".task-card", { timeout: 10000 })
        .catch(async (error: Error) => {
          throw new Error(
            `${error.message}\nErrors: ${JSON.stringify(errors)}\nPage: ${await page.locator("body").innerText()}`,
          );
        });
      assert.equal(await page.locator(".task-card").count(), 10);
      await page.click('[data-action="settings"]');
      assert.equal(await page.locator('option[value="demo"]').count(), 0);
      await page.selectOption("#image-model", "gpt-image-2");
      await page.selectOption("#prompt-model", "__custom");
      await page.fill('[name="customPromptModel"]', "draft-model");
      await page.waitForResponse(
        (r: any) =>
          r.url().endsWith("/api/workspace") && r.request().method() === "GET",
      );
      assert.equal(
        await page.locator('[name="customPromptModel"]').inputValue(),
        "draft-model",
      );
      assert.equal(await page.locator("#gpt-options").isVisible(), true);
      await page.click('[data-action="close-modal"]');
      await page.click('[data-action="view"][data-view="sheet"]');
      await page.waitForSelector("#sheet-container canvas", {
        state: "attached",
      });
      await page.click('[data-action="view"][data-view="workbench"]');
      const task = f.product.tasks[0];
      await page.click(`[data-action="edit-prompt"][data-task="${task.id}"]`);
      await page.fill("#prompt-form textarea", "Production prompt");
      const promptNode = await page
        .locator("#prompt-form textarea")
        .elementHandle();
      await page.waitForResponse(
        (r: any) =>
          r.url().endsWith("/api/workspace") && r.request().method() === "GET",
      );
      assert.equal(
        await page.locator("#prompt-form textarea").inputValue(),
        "Production prompt",
      );
      assert.equal(
        await promptNode.evaluate(
          (node: HTMLElement) =>
            node === document.querySelector("#prompt-form textarea"),
        ),
        true,
      );
      await page.click('#prompt-form button[type="submit"]');
      await page.click("#save");
      await page.waitForFunction(
        () =>
          document.querySelector("#save-status")?.textContent ===
          "已保存到服务端",
      );
      await page.click(
        `[data-action="generate-image"][data-task="${task.id}"]`,
      );
      await page.waitForFunction(
        () => document.querySelector("#queue-count")?.textContent === "1",
      );
      await context.close();
      const calls = counts(),
        provider = fakeProvider(calls);
      await new Worker(f.workflows, provider).step();
      await f.due();
      await new Worker(f.workflows, provider).step();
      assert.equal(calls.submit, 1);
      const second = await browser.newContext({
        httpCredentials: { username: "admin", password },
        acceptDownloads: true,
      });
      const reopened = await second.newPage();
      reopened.on("pageerror", (e: Error) => errors.push(e.message));
      await reopened.goto(root);
      await reopened.waitForSelector(".result-image img");
      assert.equal(
        await reopened.locator(".version-history .version").count(),
        1,
      );
      const source = await reopened
        .locator(".result-image img")
        .first()
        .getAttribute("src");
      assert.ok(source?.startsWith("/api/assets/"));
      const selection = reopened
        .locator('.version-history [data-action="select-version"]')
        .first();
      await selection.check();
      await selection.uncheck();
      assert.equal(await selection.isChecked(), false);
      await selection.check();
      const [archive] = await Promise.all([
        reopened.waitForEvent("download"),
        reopened.click('[data-action="download-selected"]'),
      ]);
      const { default: JSZip } = await import("jszip");
      const zip = await JSZip.loadAsync(
        await readFile((await archive.path())!),
      );
      const imageEntry = Object.values(zip.files).find((entry) => !entry.dir)!;
      assert.ok(imageEntry.name.endsWith(".png"));
      assert.deepEqual(
        (await imageEntry.async("nodebuffer")).subarray(0, 8),
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      await reopened.click('[data-action="view"][data-view="sheet"]');
      await reopened
        .waitForSelector("#sheet-container canvas", {
          timeout: 10000,
          state: "attached",
        })
        .catch(async (error: Error) => {
          throw new Error(
            `${error.message}\nErrors: ${JSON.stringify(errors)}\nToast: ${await reopened.locator("#toast").innerText()}\nSheet: ${(await reopened.locator("#sheet-container").innerHTML()).slice(0, 3000)}`,
          );
        });
      await reopened.waitForTimeout(600);
      const canvas = await reopened
        .locator("#sheet-container canvas")
        .first()
        .elementHandle();
      await reopened.click('[data-action="view"][data-view="queue"]');
      await reopened
        .locator(".queue-job-details")
        .evaluate((element: HTMLDetailsElement) => {
          element.open = true;
        });
      await reopened.selectOption("#concurrency", "2");
      await reopened.waitForResponse(
        (r: any) =>
          r.url().endsWith("/api/workspace") && r.request().method() === "GET",
      );
      assert.equal(
        await reopened
          .locator(".queue-job-details")
          .evaluate((element: HTMLDetailsElement) => element.open),
        true,
      );
      await reopened.click('[data-action="view"][data-view="sheet"]');
      assert.equal(
        await canvas.evaluate(
          (node: HTMLElement) =>
            node === document.querySelector("#sheet-container canvas"),
        ),
        true,
      );
      await reopened.click('[data-action="parse-sheet"]');
      await reopened
        .locator("#modal details")
        .evaluate((element: HTMLDetailsElement) => {
          element.open = true;
        });
      await reopened.selectOption("#parse-layout", "three");
      assert.equal(
        await reopened
          .locator("#modal details")
          .evaluate((element: HTMLDetailsElement) => element.open),
        true,
      );
      await reopened.press("#parse-header", "Escape");
      assert.equal(
        await reopened
          .locator("#modal")
          .evaluate((dialog: HTMLDialogElement) => dialog.open),
        false,
      );
      await reopened.click('[data-action="view"][data-view="workbench"]');
      await reopened.click('[data-action="manage-photos"]');
      await reopened.click('[data-action="remove-photo"][data-index="0"]');
      assert.equal(await reopened.locator(".media-gallery img").count(), 0);
      const payload = {
        name: "product.png",
        mimeType: "image/png",
        buffer: Buffer.from(png.split(",")[1], "base64"),
      };
      const [chooser] = await Promise.all([
        reopened.waitForEvent("filechooser"),
        reopened.click('[data-action="choose-image-files"]'),
      ]);
      await chooser.setFiles(payload);
      await reopened.waitForSelector(".media-gallery img");
      assert.equal(await reopened.locator(".media-gallery img").count(), 1);
      const [replacement] = await Promise.all([
        reopened.waitForEvent("filechooser"),
        reopened.click(
          '[data-action="choose-image-files"][data-replace="true"]',
        ),
      ]);
      await replacement.setFiles(payload);
      await reopened.waitForFunction(() =>
        document
          .querySelector("#media-feedback")
          ?.textContent?.includes("已替换为 1 张图片"),
      );
      assert.equal(await reopened.locator(".media-gallery img").count(), 1);
      await reopened.click('[data-action="close-modal"]');
      await reopened.click('[data-action="view"][data-view="sheet"]');
      const [download] = await Promise.all([
        reopened.waitForEvent("download"),
        reopened.click('[data-action="backup"]'),
      ]);
      const backup = JSON.parse(
        await readFile((await download.path())!, "utf8"),
      );
      assert.ok(
        backup.products[0].tasks[0].versions[0].source.startsWith(
          "data:image/",
        ),
      );
      assert.equal(backup.products[0].tasks[0].prompt, "Production prompt");
      const resultCell = backup.sheetSnapshot.sheets.preview.cellData[3][4];
      const picture = Object.values(resultCell.p.drawings)[0] as {
        source: string;
      };
      assert.equal(
        picture.source,
        backup.products[0].tasks[0].versions[0].source,
      );
      // A timed-out analysis must offer recovery rather than stay disabled.
      const workspace = await f.workflows.repo.view();
      const product = workspace.products[0];
      await f.workflows.enqueue(
        "browser-analysis-recovery",
        product.tasks.map((task) => ({
          productId: product.id,
          taskId: task.id,
        })),
        "prompt-set",
      );
      const liveJob = (await f.workflows.repo.claim("browser-stream"))!;
      await f.workflows.repo.markStage(liveJob, "analyzing");
      const leaseBefore = (
        await f.db.query("SELECT lease_until FROM jobs WHERE id=$1", [
          liveJob.id,
        ])
      ).rows[0].lease_until;
      const drafts = {
        [product.tasks[0].role]:
          "实时提示词：黑色缎面布料的尺寸布局，清晰的标注与自然光线。",
      };
      await f.workflows.repo.saveAnalysisProgress(liveJob, drafts, 50);
      f.workflows.analysisEvents.publish({
        id: liveJob.id,
        drafts,
        receivedChars: 50,
      });
      await reopened.click('[data-action="view"][data-view="workbench"]');
      await reopened.waitForFunction(() =>
        document
          .querySelector(".prompt-preview-text")
          ?.textContent?.includes("黑色缎面布料"),
      );
      const promptCard = reopened.locator(
        `.task-card[data-task="${product.tasks[0].id}"]`,
      );
      assert.equal(await promptCard.locator(".typing-caret").count(), 1);
      assert.equal(
        await promptCard.locator('[data-action="generate-image"]').isDisabled(),
        true,
      );
      assert.equal(
        (
          await f.db.query("SELECT lease_until FROM jobs WHERE id=$1", [
            liveJob.id,
          ])
        ).rows[0].lease_until,
        leaseBefore,
      );
      assert.equal(
        (await f.workflows.repo.view()).products[0].tasks[0].prompt,
        "Production prompt",
      );
      await reopened.reload();
      await reopened.click('[data-action="view"][data-view="workbench"]');
      await reopened.waitForFunction(() =>
        document
          .querySelector(".prompt-preview-text")
          ?.textContent?.includes("黑色缎面布料"),
      );
      await reopened.screenshot({
        path: "browser-streaming-prompt.png",
        fullPage: true,
      });
      assert.equal(
        await promptCard
          .locator(".prompt-preview-footer")
          .evaluate((node: HTMLElement) => {
            const parent = node
              .closest(".result-area")!
              .getBoundingClientRect();
            return node.getBoundingClientRect().bottom <= parent.bottom;
          }),
        true,
      );
      await f.db.query(
        "UPDATE jobs SET status='interrupted',stage='analyzing' WHERE kind='prompt-set' AND status='running'",
      );
      await reopened.click('[data-action="view"][data-view="workbench"]');
      const recovery = reopened.locator(
        '.product-info [data-action="reconcile-job"]',
      );
      await recovery.waitFor();
      assert.equal(await recovery.isEnabled(), true);
      assert.match(await recovery.innerText(), /分析中断/);
      await recovery.click();
      assert.equal(
        await reopened
          .locator("#modal")
          .evaluate((dialog: HTMLDialogElement) => dialog.open),
        true,
      );
      await reopened.click('[data-action="close-modal"]');
      await f.db.query(
        "UPDATE jobs SET payload=json_remove(json_set(payload,'$.error','平台请求失败 (429)'),'$.promptDrafts') WHERE id=$1",
        [liveJob.id],
      );
      f.workflows.analysisEvents.publish({
        id: liveJob.id,
        finished: true,
        status: "interrupted",
        error: "平台请求失败 (429)",
      });
      await reopened.waitForFunction(() =>
        document.querySelector(".prompt-error")?.textContent?.includes("429"),
      );
      assert.equal(await reopened.locator(".prompt-error").count(), 10);
      assert.equal(await reopened.locator(".typing-caret").count(), 0);
      assert.equal(await reopened.locator(".prompt-waiting").count(), 0);
      await f.db.query(
        "UPDATE jobs SET status='running' WHERE kind='prompt-set' AND status='interrupted'",
      );
      const busy = reopened.locator(
        '.product-info [data-action="generate-prompt"]',
      );
      await busy.waitFor();
      assert.equal(await busy.isDisabled(), true);
      assert.equal(
        await busy.evaluate(
          (node: HTMLElement) => getComputedStyle(node).cursor,
        ),
        "default",
      );
      await reopened.click('[data-action="view"][data-view="queue"]');
      await reopened
        .locator(".queue-job-details")
        .evaluate((node: HTMLDetailsElement) => (node.open = true));
      const activeRow = reopened.locator(
        `.queue-row[data-job="${liveJob.id}"]`,
      );
      await activeRow.locator(".status-spinner").waitFor();
      assert.match(
        await activeRow.locator(".queue-status").innerText(),
        /分析中/,
      );
      assert.equal(
        await reopened.locator('[data-action="cancel-product-jobs"]').count(),
        1,
      );
      await activeRow.locator('[data-action="cancel-job"]').click();
      await reopened.waitForFunction(
        (id: string) =>
          document
            .querySelector(`.queue-row[data-job="${id}"] .queue-status`)
            ?.textContent?.includes("已取消"),
        liveJob.id,
      );
      assert.equal(await activeRow.locator(".status-spinner").count(), 0);
      await f.workflows.enqueue(
        "browser-stop-image",
        [{ productId: product.id, taskId: product.tasks[0].id }],
        "image",
      );
      const imageJob = (await f.workflows.repo.claim("browser-image"))!;
      await f.workflows.repo.markStage(imageJob, "submitting");
      const imageRow = reopened.locator(
        `.queue-row[data-job="${imageJob.id}"]`,
      );
      await imageRow.locator(".status-spinner").waitFor();
      assert.match(
        await imageRow.locator(".queue-status").innerText(),
        /生成中/,
      );
      await reopened.locator('[data-action="cancel-product-jobs"]').click();
      await reopened.waitForFunction(
        (id: string) =>
          document
            .querySelector(`.queue-row[data-job="${id}"] .queue-status`)
            ?.textContent?.includes("已取消"),
        imageJob.id,
      );
      assert.equal(await reopened.locator(".status-spinner").count(), 0);
      assert.deepEqual(errors, []);
      await second.close();
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
