import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fixture, pairs, password } from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";
import { GrsaiProvider } from "../../server/production/provider.js";
import { Worker } from "../../server/production/worker.js";

test(
  "a saved HTTP 413 shows Chinese guidance and its request ID on desktop and mobile",
  { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 30000 },
  async (t) => {
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
          value: "已保存的产品设计提示词",
        },
      ]);
      const fetch = t.mock.method(
        globalThis,
        "fetch",
        async () =>
          new Response("<html>proxy body too large</html>", {
            status: 413,
            headers: {
              "content-type": "text/html",
              "x-request-id": "browser-413",
            },
          }),
      );
      await f.workflows.enqueue(
        randomUUID(),
        pairs(f.product).slice(0, 1),
        "image",
      );
      await f.due();
      await new Worker(
        f.workflows,
        new GrsaiProvider(f.workflows.assets),
        () => {},
      ).step();
      assert.equal(fetch.mock.callCount(), 1);
      fetch.mock.restore();
      const job = (await f.workflows.repo.view()).jobs[0];
      assert.equal(job.status, "failed");
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(
        `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`,
      );
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      const message = page
        .locator(".task-card")
        .first()
        .locator(".inline-error");
      await message.waitFor();
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 900 });
        const text = await message.innerText();
        assert.match(text, /提交的数据总量超过服务限制/);
        assert.match(text, /HTTP 413.*browser-413/);
        assert.doesNotMatch(text, /<html>|proxy body/);
        assert.ok(
          await message.evaluate(
            (node: HTMLElement) => node.scrollWidth <= node.clientWidth + 1,
          ),
        );
        await page.screenshot({
          path: artifactPath(`provider-error-413-${width}.png`),
        });
      }
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);

test(
  "a missing-result error offers fresh generation without deleting the original platform ID",
  { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 30000 },
  async (t) => {
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
          value: "保存的生图提示词",
        },
      ]);
      let submitted = 0;
      const mock = t.mock.method(globalThis, "fetch", async (url: unknown) => {
        if (String(url).endsWith("/v1/api/generate")) {
          submitted++;
          return Response.json({ id: "old-platform-task" });
        }
        return Response.json(
          { error: "result not exist, valid for 2 hours" },
          { status: 404 },
        );
      });
      await f.workflows.enqueue(
        randomUUID(),
        pairs(f.product).slice(0, 1),
        "image",
      );
      const worker = new Worker(
        f.workflows,
        new GrsaiProvider(f.workflows.assets),
        () => {},
      );
      await worker.step();
      for (let i = 0; i < 5; i++) {
        await f.due();
        await worker.step();
      }
      mock.mock.restore();
      const original = (await f.workflows.repo.view()).jobs[0];
      assert.equal(original.status, "failed");
      assert.equal(submitted, 1);
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(
        `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`,
      );
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      const card = page.locator(".task-card").first();
      const message = card.locator(".inline-error");
      await message.waitFor();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        const text = await message.innerText();
        assert.match(text, /暂未找到该任务的结果.*重新生成/);
        assert.doesNotMatch(text, /接口或任务|已经过期/);
        assert.equal(
          await message
            .getByRole("button", { name: "重新生成", exact: true })
            .isVisible(),
          true,
        );
        assert.ok(
          await message.evaluate(
            (node: HTMLElement) => node.scrollWidth <= node.clientWidth + 1,
          ),
        );
      }
      await message.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: artifactPath("missing-result-regenerate-mobile.png"),
      });
      await message
        .getByRole("button", { name: "重新生成", exact: true })
        .click();
      await card
        .locator(".generation-progress strong")
        .getByText("等待生成", { exact: true })
        .waitFor();
      const jobs = (await f.workflows.repo.view()).jobs;
      assert.equal(jobs.length, 2);
      assert.equal(
        jobs.find((job) => job.id === original.id)!.remoteId,
        "old-platform-task",
      );
      const replacement = jobs.find((job) => job.id !== original.id)!;
      assert.equal(replacement.status, "queued");
      assert.equal(replacement.stage, "pending");
      assert.equal(replacement.remoteId, undefined);
      assert.equal(replacement.replacesJobId, original.id);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
