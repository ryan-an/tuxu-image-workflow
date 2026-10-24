import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fixture, password } from "../support/production.js";

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
      await first.getByText("等待平台响应", { exact: true }).waitFor();
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
        const drafts = Object.fromEntries(
          f.product.tasks.map((task) => [task.role, `${task.role}：${suffix}`]),
        );
        await f.workflows.repo.saveAnalysisProgress(job, drafts, 100);
        f.workflows.analysisEvents.publish({
          id: job.id,
          drafts,
          receivedChars: 100,
        });
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
      assert.equal(
        await editor(typed).inputValue(),
        "手动草稿，不能被生成结果覆盖",
      );
      assert.equal(await editor(cleared).inputValue(), "");

      await f.workflows.repo.updateClaim(job, async (tx, state, current) => {
        const product = state.products.find(
          (item) => item.id === f.product.id,
        )!;
        for (const task of product.tasks)
          task.prompt = `${task.role}：完整提示词`;
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
        "尺寸图：完整提示词",
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
          before: "尺寸图：完整提示词",
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
