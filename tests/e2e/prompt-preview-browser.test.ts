import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fixture, password } from "../support/production.js";
import { parseSuiteResponse } from "../../shared/prompt-suite.js";
import { streamedPrompts } from "../../shared/streamed-prompts.js";
import { artifactPath } from "../support/artifacts.cjs";

test(
  "generated prompts replace untouched editors while typed and cleared drafts survive streaming and completion",
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
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      page.setDefaultTimeout(8000);
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(
        `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`,
      );
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      const cards = page.locator(".task-card"),
        first = cards.nth(0),
        typed = cards.nth(1),
        cleared = cards.nth(2);
      for (const card of [first, typed, cleared])
        await card
          .getByRole("button", { name: "点击编写提示词", exact: true })
          .click();
      const editor = (card: any) =>
        card.locator(".inline-prompt-form textarea");
      await editor(typed).fill("手动草稿，不能被生成结果覆盖");
      await editor(cleared).fill("主动清空的草稿");
      await editor(cleared).fill("");
      await page
        .getByRole("button", { name: "生成整套提示词", exact: true })
        .click();
      await first.locator(".prompt-preview.is-streaming").waitFor();
      assert.equal(await editor(first).count(), 0);
      assert.equal(
        await editor(typed).inputValue(),
        "手动草稿，不能被生成结果覆盖",
      );
      assert.equal(await editor(cleared).inputValue(), "");

      // Reproduce opening the empty editor while the first response is pending.
      await first
        .getByRole("button", { name: "点击编写提示词", exact: true })
        .click();
      const job = (await f.workflows.repo.claim("prompt-preview-browser"))!;
      assert.ok(job);
      await f.workflows.repo.markStage(job, "analyzing");
      const publish = async (suffix: string) => {
        const raw = JSON.stringify({
          images: f.product.tasks.map((task) => ({
            role: task.role,
            prompt: `${task.role}：${suffix}`,
          })),
        });
        const drafts = streamedPrompts(raw);
        await f.workflows.repo.saveAnalysisProgress(job, drafts, raw.length);
        f.workflows.analysisEvents.publish({
          id: job.id,
          drafts,
          receivedChars: raw.length,
        });
        return parseSuiteResponse(raw, 0, f.product).prompts;
      };
      await publish("正在生成的第一段提示词");
      await first
        .locator(".prompt-preview-text")
        .filter({ hasText: "第一段提示词" })
        .waitFor();
      assert.equal(await editor(first).count(), 0);
      await publish("正在生成的第一段提示词，后续内容继续出现");
      await first
        .locator(".prompt-preview-text")
        .filter({ hasText: "后续内容继续出现" })
        .waitFor();
      await publish("已收到的内容。".repeat(1000) + "这批内容应立即完整显示");
      await first
        .locator(".prompt-preview-text")
        .filter({ hasText: "这批内容应立即完整显示" })
        .waitFor({ timeout: 1000 });
      assert.equal(
        await editor(typed).inputValue(),
        "手动草稿，不能被生成结果覆盖",
      );
      assert.equal(await editor(cleared).inputValue(), "");

      const complete = await publish(
        "完整提示词\n第一部分：布局与英文文案\n【指定末句】\n第二部分：设计规范\n第三部分：产品要求\n第四部分：图片尺寸",
      );
      await first
        .locator(".prompt-preview-text")
        .filter({ hasText: "第四部分：图片尺寸" })
        .waitFor();
      assert.equal(
        await first.locator(".prompt-preview-text").textContent(),
        complete[0].prompt,
      );
      await f.workflows.repo.updateClaim(job, async (tx, state, current) => {
        const product = state.products.find(
          (item) => item.id === f.product.id,
        )!;
        for (const task of product.tasks)
          task.prompt = complete.find(
            (item: { role: string; prompt: string }) => item.role === task.role,
          )!.prompt;
        await f.workflows.repo.saveProduct(tx, product);
        current.status = "completed";
        current.stage = "completed";
      });
      f.workflows.analysisEvents.publish({
        id: job.id,
        finished: true,
        status: "completed",
      });
      await first.getByText("提示词已就绪", { exact: true }).waitFor();
      assert.equal(
        await first.locator(".prompt-preview-text").innerText(),
        complete[0].prompt,
      );
      assert.equal(
        await editor(typed).inputValue(),
        "手动草稿，不能被生成结果覆盖",
      );
      assert.equal(await editor(cleared).inputValue(), "");
      for (const card of [typed, cleared]) {
        await card.getByRole("button", { name: "取消", exact: true }).click();
        assert.match(
          await card.locator(".prompt-preview-text").innerText(),
          /完整提示词/,
        );
      }

      // A response can finish between refreshes without a streaming transition.
      await first.locator(".prompt-preview-text").click();
      await f.workflows.edit([
        {
          path: [
            "products",
            f.product.id,
            "tasks",
            f.product.tasks[0].id,
            "prompt",
          ],
          before: complete[0].prompt,
          value: "尺寸图：后续生成结果",
        },
      ]);
      await Promise.all([
        page.waitForResponse((response: any) =>
          response.url().includes("/api/workspace/changes?"),
        ),
        page.evaluate(() =>
          document.dispatchEvent(new Event("visibilitychange")),
        ),
      ]);
      await first
        .locator(".prompt-preview-text")
        .filter({ hasText: "后续生成结果" })
        .waitFor();
      assert.equal(await editor(first).count(), 0);
      await first.locator('[data-action="edit-prompt"]').click();
      assert.equal(
        await page.locator("#prompt-form textarea").inputValue(),
        "尺寸图：后续生成结果",
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);

test(
  "prompt preview renders original formatting and line breaks for any section count while editing retains the source",
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
    const source = `## 豆包原文标题\n\n第一行\n第二行\n\n**重点文案**\n\n- 列表甲\n- 列表乙\n\n| 项目 | 内容 |\n| --- | --- |\n| 材质 | 原文资料 |\n\n\`\`\`text\n原样代码第一行\n原样代码第二行\n\`\`\`\n\n<b>原始标签文本</b>\n\n${Array.from({ length: 20 }, (_, index) => `### 任意段落 ${index + 1}\n\n模型写出的原始段落 ${index + 1}。`).join("\n\n")}\n`;
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
          before: f.product.tasks[0].prompt,
          value: source,
        },
      ]);
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      await page.goto(
        `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`,
      );
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      const first = page.locator(".task-card").first();
      const preview = first.locator(".prompt-preview-text");
      await preview
        .getByRole("heading", { name: "豆包原文标题" })
        .waitFor({ state: "attached" });
      assert.equal(await preview.locator("h3").count(), 20);
      assert.equal(await preview.locator("strong").innerText(), "重点文案");
      assert.equal(await preview.locator("li").count(), 2);
      assert.equal(await preview.locator("table td").count(), 2);
      assert.equal(
        await preview.locator("pre code").textContent(),
        "原样代码第一行\n原样代码第二行\n",
      );
      assert.equal(await preview.locator("b").count(), 0);
      assert.ok((await preview.textContent())!.includes("<b>原始标签文本</b>"));
      const lines = await preview
        .locator("p")
        .filter({ hasText: "第一行" })
        .evaluate((element: HTMLElement) => {
          const node = element.firstChild!;
          const range = document.createRange();
          range.setStart(node, 0);
          range.setEnd(node, 1);
          const firstTop = range.getBoundingClientRect().top;
          const next = node.textContent!.indexOf("第二行");
          range.setStart(node, next);
          range.setEnd(node, next + 1);
          return {
            whiteSpace: getComputedStyle(element).whiteSpace,
            lineDistance: range.getBoundingClientRect().top - firstTop,
          };
        });
      assert.equal(lines.whiteSpace, "pre-wrap");
      assert.ok(lines.lineDistance > 10);
      await preview
        .getByRole("heading", { name: "豆包原文标题" })
        .scrollIntoViewIfNeeded();
      await first.screenshot({
        path: artifactPath("prompt-preview-formatting-desktop.png"),
      });
      await page.setViewportSize({ width: 390, height: 844 });
      const widths = await first
        .locator(".prompt-preview-body")
        .evaluate((element: HTMLElement) => ({
          client: element.clientWidth,
          scroll: element.scrollWidth,
        }));
      assert.ok(widths.scroll <= widths.client + 1);
      await first.screenshot({
        path: artifactPath("prompt-preview-formatting-mobile.png"),
      });
      await preview.getByRole("heading", { name: "豆包原文标题" }).click();
      assert.equal(
        await first.locator(".inline-prompt-form textarea").inputValue(),
        source,
      );
      assert.equal(
        (await f.workflows.repo.view()).products[0].tasks[0].prompt,
        source,
      );
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
