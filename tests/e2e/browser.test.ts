import { artifactPath } from "../support/artifacts.cjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import {
  fixture,
  fakeProvider,
  counts,
  password,
  png,
} from "../support/production.js";
import { Worker } from "../../server/production/worker.js";
test(
  "Doubao settings and card conversations keep keys and card context independent",
  { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 60000 },
  async () => {
    const { chromium } = createRequire(import.meta.url)(
      process.env.PLAYWRIGHT_MODULE!,
    );
    const f = await fixture(resolve("dist")),
      original = globalThis.fetch;
    const calls: any[] = [];
    let slowStarted!: () => void;
    const waiting = new Promise<void>((resolve) => {
      slowStarted = resolve;
    });
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options?.body as string);
      calls.push({
        body,
        authorization: (options?.headers as any).Authorization,
      });
      if (body.input.at(-1).content[0].text === "模型未开通")
        return Response.json(
          { error: { code: "ModelNotOpen" } },
          { status: 404 },
        );
      if (body.input.at(-1).content[0].text === "等待回复") {
        slowStarted();
        return new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(new DOMException("Aborted", "AbortError"));
          if (options?.signal?.aborted) abort();
          else
            options?.signal?.addEventListener("abort", abort, { once: true });
        });
      }
      return Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: `建议 ${calls.length}：保持产品比例，增加留白。`,
              },
            ],
          },
        ],
      });
    };
    const browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROME_PATH
        ? { executablePath: process.env.CHROME_PATH }
        : {}),
    });
    try {
      const product = (await f.workflows.repo.view()).products[0];
      const source = await f.workflows.assets.normalize(png);
      product.tasks[0].prompt = "卡片一的提示词";
      product.tasks[0].versions.push({
        id: "chat-result",
        source,
        prompt: "结果原始提示词",
        number: 1,
        createdAt: Date.now(),
        origin: "generated",
      });
      product.tasks[0].primaryId = "chat-result";
      await f.workflows.repo.saveProduct(f.db, product);
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
      await page.locator(".task-card").first().waitFor();
      await page.locator("#api-keys-button").click();
      assert.equal(
        await page
          .locator('#credentials-form [name="promptApiKey"]')
          .getAttribute("type"),
        "password",
      );
      await page.fill(
        '#credentials-form [name="promptApiKey"]',
        "browser-doubao-key",
      );
      await page.locator('#credentials-form button[type="submit"]').click();
      await page.locator("#credentials-form").waitFor({ state: "detached" });
      assert.equal(await f.workflows.key(), "fake-platform-key");
      assert.equal(await f.workflows.key("doubao"), "browser-doubao-key");
      await page.locator('[data-action="settings"]').first().click();
      assert.equal(
        await page.locator("#prompt-model").inputValue(),
        "doubao-seed-2-1-pro-260915",
      );
      await page.selectOption("#prompt-model", "__custom");
      await page.fill('[name="customPromptModel"]', "ep-my-doubao-model");
      await page.locator('#settings-form button[type="submit"]').click();
      await page.locator("#settings-form").waitFor({ state: "detached" });
      assert.equal(
        (
          await f.app.inject({
            url: "/api/workflow/settings",
            headers: {
              cookie: (await page.context().cookies())
                .map((cookie: any) => `${cookie.name}=${cookie.value}`)
                .join("; "),
            },
          })
        ).json().promptModel,
        "ep-my-doubao-model",
      );
      await page
        .locator(
          `[data-action="ask-doubao"][data-task="${product.tasks[0].id}"]`,
        )
        .click();
      await page.locator("#assistant-panel").waitFor({ state: "visible" });
      assert.match(
        await page.locator(".assistant-context").innerText(),
        /尺寸图/,
      );
      assert.equal(await page.locator(".assistant-context img").count(), 1);
      await page
        .getByRole("textbox", { name: "发给豆包的消息" })
        .fill("帮我优化这张图");
      await page.locator('.assistant-composer button[type="submit"]').click();
      await page.locator(".assistant-message.assistant").waitFor();
      assert.equal(calls[0].authorization, "Bearer browser-doubao-key");
      assert.equal(calls[0].body.model, "ep-my-doubao-model");
      assert.ok(
        calls[0].body.input[1].content.some((c: any) =>
          c.text?.includes("结果原始提示词"),
        ),
      );
      await page.locator('[data-action="close-assistant"]').click();
      await page.locator("#assistant-launcher").click();
      assert.equal(
        await page.locator(".assistant-message.assistant").count(),
        1,
      );
      await page
        .locator(
          `[data-action="ask-doubao"][data-task="${product.tasks[1].id}"]`,
        )
        .click();
      assert.equal(await page.locator(".assistant-message").count(), 0);
      assert.match(
        await page.locator(".assistant-context").innerText(),
        /卖点图/,
      );
      await page
        .locator(
          `[data-action="ask-doubao"][data-task="${product.tasks[0].id}"]`,
        )
        .click();
      await page.locator(".assistant-message.assistant").first().waitFor();
      assert.equal(
        await page.locator(".assistant-message.assistant").count(),
        1,
      );
      await page
        .getByRole("textbox", { name: "发给豆包的消息" })
        .fill("给我完整提示词");
      await page
        .getByRole("textbox", { name: "发给豆包的消息" })
        .press("Enter");
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".assistant-message.assistant").length ===
          2,
      );
      assert.equal(calls[1].body.input.at(-2).role, "assistant");
      assert.equal((await f.workflows.repo.view()).jobs.length, 0);
      if (process.env.ASSISTANT_SCREENSHOT)
        await page.screenshot({ path: process.env.ASSISTANT_SCREENSHOT });
      const modelFailure = page.waitForResponse(
        (response: any) =>
          response.url().endsWith("/api/assistant/chat") &&
          response.request().postData()?.includes("模型未开通"),
      );
      await page
        .getByRole("textbox", { name: "发给豆包的消息" })
        .fill("模型未开通");
      await page.locator('.assistant-composer button[type="submit"]').click();
      // Streaming headers arrive before the upstream result; failures are SSE events.
      assert.equal((await modelFailure).status(), 200);
      await page.locator(".assistant-error").waitFor();
      assert.match(
        await page.locator(".assistant-error").innerText(),
        /ModelNotOpen/,
      );
      assert.equal(
        await page
          .getByRole("textbox", { name: "发给豆包的消息" })
          .inputValue(),
        "模型未开通",
      );
      assert.equal(
        await page.locator(".assistant-error a").getAttribute("href"),
        "https://ark.volcengine.com/region:cn-beijing/openManagement",
      );
      await page
        .getByRole("textbox", { name: "发给豆包的消息" })
        .fill("等待回复");
      await page.locator('.assistant-composer button[type="submit"]').click();
      await waiting;
      await page.getByRole("button", { name: "停止回复", exact: true }).click();
      await page
        .getByRole("textbox", { name: "发给豆包的消息" })
        .fill("继续优化");
      await page.locator('.assistant-composer button[type="submit"]').click();
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".assistant-message.assistant").length ===
          3,
      );
      assert.equal(calls.at(-1).body.input.at(-1).content[0].text, "继续优化");
      assert.equal(await page.locator(".assistant-message.user").count(), 5);
      assert.equal(await page.locator(".assistant-turn-status").count(), 2);
      await page.setViewportSize({ width: 390, height: 844 });
      const panel = await page.locator("#assistant-panel").boundingBox();
      assert.ok(
        panel &&
          panel.x >= 0 &&
          panel.x + panel.width <= 390 &&
          panel.y >= 0 &&
          panel.y + panel.height <= 844,
      );
      assert.equal(await page.locator("#assistant-panel select").count(), 0);
      const modelCalls = calls.length;
      await page
        .getByRole("button", { name: "清空对话历史", exact: true })
        .click();
      await page.locator(".assistant-welcome").waitFor();
      assert.equal(await page.locator(".assistant-message").count(), 0);
      assert.equal(
        (
          await f.db.query(
            "SELECT * FROM assistant_conversations WHERE product_id=$1 AND task_id=$2",
            [product.id, product.tasks[0].id],
          )
        ).rowCount,
        0,
      );
      await page.reload();
      await page
        .locator(
          `[data-action="ask-doubao"][data-task="${product.tasks[0].id}"]`,
        )
        .click();
      await page.locator(".assistant-welcome").waitFor();
      assert.equal(await page.locator(".assistant-message").count(), 0);
      assert.equal(calls.length, modelCalls);
      assert.deepEqual(errors, []);
      await page.close();
      await f.reopen();
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const afterRestart = await browser.newPage();
      await afterRestart.goto(
        `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`,
      );
      await afterRestart.fill("#login-password", password);
      await afterRestart.click('#login-form button[type="submit"]');
      await afterRestart
        .locator(
          `[data-action="ask-doubao"][data-task="${product.tasks[0].id}"]`,
        )
        .click();
      await afterRestart.locator(".assistant-welcome").waitFor();
      assert.equal(await afterRestart.locator(".assistant-message").count(), 0);
      assert.equal(calls.length, modelCalls);
      await afterRestart
        .getByRole("textbox", { name: "发给豆包的消息" })
        .fill("清空后重新咨询");
      await afterRestart
        .getByRole("button", { name: "发送消息", exact: true })
        .click();
      await afterRestart.locator(".assistant-message.assistant").waitFor();
      assert.equal(calls.length, modelCalls + 1);
      assert.equal(calls.at(-1).body.input.length, 3);
      assert.equal(
        calls.at(-1).body.input.at(-1).content[0].text,
        "清空后重新咨询",
      );
    } finally {
      globalThis.fetch = original;
      await browser.close();
      await f.close();
    }
  },
);
test(
  "frontend login page handles errors, refresh, logout and expired sessions",
  { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 30000 },
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
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors: string[] = [],
        requests: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      page.on("request", (request: any) =>
        requests.push(new URL(request.url()).pathname),
      );
      await page.goto(root);
      await page.waitForURL(`${root}/login`);
      await page.locator("#login-form").waitFor();
      assert.equal(requests.includes("/api/workspace"), false);
      assert.equal(await page.locator("#app").count(), 0);
      assert.equal(await page.locator("#login-username").inputValue(), "admin");
      assert.equal(
        await page.locator("#login-password").getAttribute("type"),
        "password",
      );
      await page.fill("#login-password", "incorrect-password");
      await page.getByRole("button", { name: "显示密码" }).click();
      assert.equal(
        await page.locator("#login-password").getAttribute("type"),
        "text",
      );
      await page.getByRole("button", { name: "隐藏密码" }).click();
      await page.locator('#login-form button[type="submit"]').click();
      await page.locator("#login-error").waitFor();
      assert.equal(
        await page.locator("#login-error").innerText(),
        "用户名或密码不正确",
      );
      assert.equal(new URL(page.url()).pathname, "/login");
      await page.fill("#login-password", password);
      await page.locator("#login-password").press("Enter");
      await page.locator("#app").waitFor();
      assert.equal(new URL(page.url()).pathname, "/");
      const cookie = (await context.cookies()).find(
        (cookie: any) => cookie.name === "tuxu_session",
      );
      assert.equal(cookie.httpOnly, true);
      assert.equal(cookie.sameSite, "Strict");
      assert.equal(
        await page.evaluate(() =>
          JSON.stringify({ ...localStorage, ...sessionStorage }).includes(
            "test-password-123456789",
          ),
        ),
        false,
      );
      await page.reload();
      await page.locator("#app").waitFor();
      await page.goto(`${root}/login`);
      await page.locator("#app").waitFor();
      assert.equal(new URL(page.url()).pathname, "/");
      await page.getByRole("button", { name: "账号菜单", exact: true }).click();
      await page.locator("#logout").click();
      await page.waitForURL(`${root}/login`);
      await page.locator("#login-form").waitFor();
      const denied = await context.request.get(`${root}/api/workspace`, {
        headers: { Cookie: `tuxu_session=${cookie.value}` },
      });
      assert.equal(denied.status(), 401);
      await page.goto(root);
      await page.waitForURL(`${root}/login`);
      await page.fill("#login-password", password);
      await page.locator('#login-form button[type="submit"]').click();
      await page.locator("#app").waitFor();
      await context.clearCookies();
      // Resume synchronization explicitly instead of spending the timeout on
      // the idle poll interval when this suite runs alongside other browsers.
      await page.evaluate(() =>
        document.dispatchEvent(new Event("visibilitychange")),
      );
      await page.waitForURL(`${root}/login`);
      assert.equal(await page.locator("#app").count(), 0);
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.locator("#login-form").isVisible(), true);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
      assert.deepEqual(errors, []);
      await context.close();
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
test(
  "production browser saves, submits, closes and reloads durable results and exports an independent example template",
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
        acceptDownloads: true,
      });
      const page = await context.newPage(),
        errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(e.message));
      await page.goto(root);
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
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
      await Promise.all([
        page.waitForResponse(
          (r: any) =>
            r.url().includes("/api/workspace/changes?") &&
            r.request().method() === "GET",
        ),
        page.evaluate(() =>
          document.dispatchEvent(new Event("visibilitychange")),
        ),
      ]);
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
      await Promise.all([
        page.waitForResponse(
          (r: any) =>
            r.url().includes("/api/workspace/changes?") &&
            r.request().method() === "GET",
        ),
        page.evaluate(() =>
          document.dispatchEvent(new Event("visibilitychange")),
        ),
      ]);
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
      await page.locator("#prompt-form").waitFor({ state: "detached" });
      await page.waitForFunction(
        () =>
          document.querySelector("#save-status")?.textContent === "已保存数据",
      );
      await page.waitForFunction(
        () => document.querySelector("#queue-count")?.textContent === "1",
      );
      const savedJob = (await f.workflows.repo.view()).jobs[0];
      assert.equal(savedJob.taskId, task.id);
      assert.equal(savedJob.prompt, "Production prompt");
      await context.close();
      const calls = counts(),
        provider = fakeProvider(calls);
      await new Worker(f.workflows, provider).step();
      await f.due();
      await new Worker(f.workflows, provider).step();
      assert.equal(calls.submit, 1);
      const second = await browser.newContext({
        acceptDownloads: true,
      });
      const reopened = await second.newPage();
      reopened.on("pageerror", (e: Error) => errors.push(e.message));
      await reopened.goto(root);
      await reopened.fill("#login-password", password);
      await reopened.click('#login-form button[type="submit"]');
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
        .getByRole("button", { name: "队列管理", exact: true })
        .click();
      assert.equal(await reopened.locator("#concurrency").count(), 0);
      await reopened.keyboard.press("Escape");
      await reopened.click("#queue-tab-jobs");
      await Promise.all([
        reopened.waitForResponse(
          (r: any) =>
            r.url().includes("/api/workspace/changes?") &&
            r.request().method() === "GET",
        ),
        reopened.evaluate(() =>
          document.dispatchEvent(new Event("visibilitychange")),
        ),
      ]);
      assert.equal(
        await reopened.locator("#queue-tab-jobs").getAttribute("aria-selected"),
        "true",
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
        reopened.click("#media-dropzone"),
      ]);
      await chooser.setFiles(payload);
      await reopened.waitForSelector(".media-gallery img");
      assert.equal(await reopened.locator(".media-gallery img").count(), 1);
      const [duplicate] = await Promise.all([
        reopened.waitForEvent("filechooser"),
        reopened.press("#media-dropzone", "Enter"),
      ]);
      await duplicate.setFiles(payload);
      await reopened.waitForFunction(() =>
        document
          .querySelector("#media-feedback")
          ?.textContent?.includes("已跳过重复图片"),
      );
      assert.equal(await reopened.locator(".media-gallery img").count(), 1);
      await reopened.click('[data-action="close-modal"]');
      await reopened.click('[data-action="view"][data-view="sheet"]');
      const [download] = await Promise.all([
        reopened.waitForEvent("download"),
        reopened.click('[data-action="export-template"]'),
      ]);
      assert.equal(download.suggestedFilename(), "图序-产品导入模板.xlsx");
      const templatePath = artifactPath("product-import-template.xlsx");
      await download.saveAs(templatePath);
      const template = new ExcelJS.Workbook();
      await template.xlsx.readFile(templatePath);
      assert.equal(
        template.getWorksheet("产品模板")!.getCell("A2").value,
        "示例-001",
      );
      assert.equal(template.getWorksheet("产品模板")!.rowCount, 2);
      assert.ok(template.getWorksheet("填写说明"));
      assert.equal(
        await reopened
          .locator('[data-action="backup"], [data-action="restore"]')
          .count(),
        0,
      );
      assert.equal(
        (await f.workflows.repo.view()).products[0].tasks[0].prompt,
        "Production prompt",
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
        path: artifactPath("browser-streaming-prompt.png"),
        fullPage: true,
      });
      assert.equal(
        await promptCard
          .locator(".prompt-preview-footer")
          .evaluate((node: HTMLElement) => {
            const parent = node
              .closest(".task-prompt-area")!
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
        '.requirements-actions [data-action="reconcile-job"]',
      );
      await recovery.waitFor();
      assert.equal(await recovery.isEnabled(), true);
      assert.match(await recovery.innerText(), /提示词生成中断/);
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
        document
          .querySelector(".prompt-error-title")
          ?.getAttribute("title")
          ?.includes("429"),
      );
      assert.equal(await reopened.locator(".prompt-error-title").count(), 10);
      assert.equal(await reopened.locator(".prompt-error").count(), 0);
      assert.equal(await reopened.locator(".typing-caret").count(), 0);
      assert.equal(await reopened.locator(".prompt-waiting").count(), 0);
      await f.db.query(
        "UPDATE jobs SET status='running' WHERE kind='prompt-set' AND status='interrupted'",
      );
      await reopened.evaluate(() =>
        document.dispatchEvent(new Event("visibilitychange")),
      );
      const busy = reopened.locator(
        '.requirements-actions [data-action="cancel-product-analysis"]',
      );
      await busy.waitFor();
      assert.equal(await busy.isEnabled(), true);
      assert.equal(await busy.innerText(), "生成整套提示词中，点击终止");
      assert.equal(
        await busy.evaluate(
          (node: HTMLElement) => getComputedStyle(node).cursor,
        ),
        "pointer",
      );
      await reopened.click('[data-action="view"][data-view="queue"]');
      await reopened.click("#queue-tab-jobs");
      await reopened.locator(".queue-job-details").waitFor();
      const activeRow = reopened.locator(
        `.queue-row[data-job="${liveJob.id}"]`,
      );
      await activeRow.locator(".status-spinner").waitFor();
      assert.match(
        await activeRow.locator(".queue-status").innerText(),
        /分析中/,
      );
      await reopened.click("#queue-tab-products");
      assert.equal(
        await reopened.locator('[data-action="cancel-product-jobs"]').count(),
        1,
      );
      await reopened.locator('[data-action="cancel-product-jobs"]').click();
      await reopened.click("#queue-tab-jobs");
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
      await reopened.evaluate(() =>
        document.dispatchEvent(new Event("visibilitychange")),
      );
      const imageRow = reopened.locator(
        `.queue-row[data-job="${imageJob.id}"]`,
      );
      await imageRow.locator(".status-spinner").waitFor();
      assert.match(
        await imageRow.locator(".queue-status").innerText(),
        /生成中/,
      );
      await reopened.click("#queue-tab-products");
      await reopened.locator('[data-action="cancel-product-jobs"]').click();
      await reopened.click("#queue-tab-jobs");
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
