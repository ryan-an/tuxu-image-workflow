import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fixture, password } from "../support/production.js";

test(
  "browser renders live Markdown before completion, displays Doubao logos and keeps stopped partial replies",
  {
    skip: !process.env.PLAYWRIGHT_MODULE,
    timeout: 60000,
  },
  async () => {
    const { chromium } = createRequire(import.meta.url)(
      process.env.PLAYWRIGHT_MODULE!,
    );
    const f = await fixture(resolve("dist")),
      original = globalThis.fetch;
    const sources: ReadableStreamDefaultController<Uint8Array>[] = [];
    const encode = (value: object) =>
      new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
    globalThis.fetch = async (_url, options) =>
      new Response(
        new ReadableStream({
          start(controller) {
            sources.push(controller);
            options?.signal?.addEventListener(
              "abort",
              () => controller.error(options.signal!.reason),
              { once: true },
            );
            controller.enqueue(
              encode({
                type: "response.output_text.delta",
                delta:
                  sources.length === 1
                    ? "# 优化建议\n\n**保留比例**，增加留白。\n\n"
                    : "## 第二次咨询\n\n已收到的部分回复。\n\n",
              }),
            );
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    const browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROME_PATH
        ? { executablePath: process.env.CHROME_PATH }
        : {}),
    });
    try {
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
      assert.equal(
        await page.locator("#assistant-launcher .doubao-logo").count(),
        1,
      );
      const open = () =>
        page
          .locator(
            `[data-action="ask-doubao"][data-task="${f.product.tasks[0].id}"]`,
          )
          .click();
      await open();
      assert.equal(
        await page.locator(".assistant-header strong").innerText(),
        "豆包",
      );
      assert.equal(
        await page
          .locator("#assistant-panel select, .assistant-history")
          .count(),
        0,
      );
      assert.equal(
        await page
          .locator(".assistant-avatar .doubao-logo")
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
        192,
      );
      const input = page.getByRole("textbox", { name: "发给豆包的消息" });
      await input.fill("请优化提示词");
      await page.locator('.assistant-composer button[type="submit"]').click();
      await page.locator(".assistant-markdown h1").waitFor();
      assert.equal(
        await page.locator(".assistant-markdown strong").innerText(),
        "保留比例",
      );
      assert.equal(
        await page
          .getByRole("button", { name: "停止回复", exact: true })
          .isVisible(),
        true,
      );
      assert.equal(await page.locator(".assistant-stop rect").count(), 1);
      assert.equal(await page.locator(".assistant-stop").innerText(), "");
      assert.equal(
        await page
          .locator(".assistant-stop")
          .evaluate((button: HTMLElement) => getComputedStyle(button).color),
        "rgb(220, 64, 75)",
      );
      assert.equal(
        await page
          .getByRole("button", { name: "清空对话历史", exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(
        (await f.db.query("SELECT status FROM assistant_turns")).rows[0].status,
        "running",
      );
      const tail =
        "- 产品：保持 24×28cm\n- 版式：增加留白\n\n| 项目 | 建议 |\n| --- | --- |\n| 背景 | 暖色 |\n\n```text\n完整提示词：保持产品比例\n```\n\n[豆包官网](https://www.doubao.com/about)\n\n<script>window.markdownExecuted=true</script>\n\n[危险链接](javascript:alert(1))";
      sources[0].enqueue(
        encode({ type: "response.output_text.delta", delta: tail }),
      );
      await page.locator(".assistant-markdown table td").first().waitFor();
      assert.equal(await page.locator(".assistant-markdown li").count(), 2);
      assert.match(
        await page.locator(".assistant-markdown pre code").innerText(),
        /完整提示词/,
      );
      assert.equal(
        await page
          .locator(
            ".assistant-markdown script, .assistant-markdown a[href^='javascript:']",
          )
          .count(),
        0,
      );
      assert.equal(
        await page.evaluate(() => (window as any).markdownExecuted),
        undefined,
      );
      assert.equal(
        await page
          .locator(".assistant-markdown a")
          .first()
          .getAttribute("target"),
        "_blank",
      );
      assert.equal(
        await page
          .locator(".assistant-message.assistant > small .doubao-logo")
          .count(),
        1,
      );
      // The upstream completion event has still not been sent: the formatted UI is live.
      assert.equal(
        await page
          .getByRole("button", { name: "停止回复", exact: true })
          .isVisible(),
        true,
      );
      if (process.env.ASSISTANT_SCREENSHOT)
        await page
          .locator("#assistant-panel")
          .screenshot({ path: process.env.ASSISTANT_SCREENSHOT });
      const text = "# 优化建议\n\n**保留比例**，增加留白。\n\n" + tail;
      sources[0].enqueue(
        encode({
          type: "response.completed",
          response: {
            status: "completed",
            output: [
              { type: "message", content: [{ type: "output_text", text }] },
            ],
          },
        }),
      );
      await page
        .getByRole("button", { name: "停止回复", exact: true })
        .waitFor({ state: "hidden" });
      assert.equal(await page.locator(".assistant-send svg").count(), 1);
      assert.equal(await page.locator(".assistant-send").innerText(), "");
      await input.fill("停止前保留部分回复");
      await page.locator('.assistant-composer button[type="submit"]').click();
      await page.locator(".assistant-markdown h2").waitFor();
      await page.getByRole("button", { name: "停止回复", exact: true }).click();
      await page.getByText("部分回复 · 已保存", { exact: true }).waitFor();
      await page.reload();
      await page.locator(".task-card").first().waitFor();
      await open();
      await page.locator(".assistant-markdown h2").waitFor();
      assert.equal(
        await page.locator(".assistant-markdown h1").innerText(),
        "优化建议",
      );
      assert.match(
        await page.locator(".assistant-message.assistant").last().innerText(),
        /已收到的部分回复/,
      );
      assert.equal(
        await page.getByText("部分回复 · 已保存", { exact: true }).count(),
        1,
      );
      assert.equal(
        sources.length,
        2,
        "history reads must not call the model again",
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      globalThis.fetch = original;
      await f.close();
    }
  },
);
