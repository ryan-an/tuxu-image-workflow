import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Worker } from "../../server/production/worker.js";
import {
  fixture,
  password,
  png,
  fakeProvider,
  counts,
  pairs,
} from "../support/production.js";

test(
  "card reanalysis and regeneration submit only the clicked card after a suite failure",
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
      await f.workflows.edit(
        f.product.tasks.map((task) => ({
          path: ["products", f.product.id, "tasks", task.id, "prompt"],
          before: "",
          value: `原始提示词：${task.role}`,
        })),
      );
      await f.workflows.enqueue(randomUUID(), pairs(f.product), "prompt");
      await f.db.transaction(async (tx) => {
        const state = await f.workflows.repo.view(tx),
          job = state.jobs[0],
          product = state.products[0];
        job.status = "failed";
        job.error = "模型未开通";
        await f.workflows.repo.saveJob(tx, job);
        product.tasks[0].versions.push({
          id: randomUUID(),
          source: product.photo,
          prompt: product.tasks[0].prompt,
          number: 1,
          origin: "demo",
          createdAt: Date.now(),
        });
        product.tasks[0].primaryId = product.tasks[0].versions[0].id;
        await f.workflows.repo.saveProduct(tx, product);
      });
      const untouched = (await f.workflows.repo.view()).products[0].tasks.slice(
        1,
      );
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      page.setDefaultTimeout(8000);
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(root);
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      const card = page.locator(".task-card").first();
      const button = card.getByRole("button", {
        name: "重新生成提示词",
        exact: true,
      });
      await button.waitFor();
      assert.equal(
        await card.locator(".prompt-error-title").getAttribute("title"),
        "模型未开通",
      );
      const reanalysis = page.waitForRequest(
        (request: any) =>
          request.url().endsWith("/api/jobs") && request.method() === "POST",
      );
      await button.click();
      assert.deepEqual(
        (await reanalysis).postDataJSON().pairs,
        pairs(f.product).slice(0, 1),
      );
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".task-card .prompt-error-title").length ===
          9,
      );
      assert.equal(
        await page.locator(".task-card .prompt-error-title").count(),
        9,
      );
      const calls = counts(),
        worker = new Worker(f.workflows, fakeProvider(calls));
      await worker.step();
      await card
        .locator(".prompt-preview-text")
        .filter({ hasText: "prompt:尺寸图" })
        .waitFor();
      const generation = page.waitForRequest(
        (request: any) =>
          request.url().endsWith("/api/jobs") && request.method() === "POST",
      );
      await card.getByRole("button", { name: "再生成", exact: true }).click();
      assert.deepEqual(
        (await generation).postDataJSON().pairs,
        pairs(f.product).slice(0, 1),
      );
      const imageJobs = (await f.workflows.repo.view()).jobs.filter(
        (j) => j.kind === "image",
      );
      assert.equal(imageJobs.length, 1);
      assert.equal(imageJobs[0].taskId, f.product.tasks[0].id);
      assert.equal(imageJobs[0].dependsOn, undefined);
      await worker.step();
      await f.due();
      await worker.step();
      assert.deepEqual(
        (await f.workflows.repo.view()).products[0].tasks.slice(1),
        untouched,
      );
      assert.deepEqual(calls, { analyze: 1, submit: 1, query: 1 });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);

test(
  "parallel clipboard import keeps image positions, merged metadata, blanks and partial failures",
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
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const page = await browser.newPage();
      await page.goto(root);
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      await page.locator("#app").waitFor();
      await page.click('[data-action="view"][data-view="sheet"]');
      await page.locator("#sheet-container canvas").first().waitFor();
      await page.getByText("外部粘贴", { exact: true }).click();
      const images = await page.evaluate(() =>
        ["#efb88c", "#7a9d83"].map((color) => {
          const canvas = document.createElement("canvas");
          canvas.width = 300;
          canvas.height = 150;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 300, 150);
          return canvas.toDataURL();
        }),
      );
      let active = 0,
        peak = 0,
        requests = 0;
      await page.route("**/api/shimo-image", async (route: any) => {
        const url = route.request().postDataJSON().url;
        active++;
        requests++;
        peak = Math.max(peak, active);
        await new Promise((done) =>
          setTimeout(done, url.includes("slow") ? 100 : 25),
        );
        await route.fulfill({
          status: url.includes("fail") ? 502 : 200,
          contentType: "image/png",
          body: Buffer.from(
            images[url.includes("green") ? 1 : 0].split(",")[1],
            "base64",
          ),
        });
        active--;
      });
      await page.evaluate(() => {
        const url = (name: string) => `https://uploader.shimo.im/f/${name}.png`;
        const html = `<table><tr><td>产品编号</td><td>产品名称</td><td>内容</td><td>尺寸图</td><td>卖点图</td><td>细节图</td></tr><tr><td rowspan="3">FAST-01</td><td rowspan="3">合并产品</td><td>示例图</td><td><img src="${url("slow-orange")}"></td><td></td><td><img src="${url("green")}"></td></tr><tr><td>提示词</td><td>尺寸手动提示</td><td></td><td>细节手动提示</td></tr><tr><td>结果图</td><td></td><td></td><td></td></tr>${Array.from({ length: 8 }, (_, i) => `<tr><td>FAST-${i + 2}</td><td>产品 ${i + 2}</td><td>示例图</td><td><img src="${url(`unique-${i}`)}"></td><td><img src="${url("green")}"></td><td><img src="${url("fail")}"></td></tr>`).join("")}</table>`;
        const clipboardData = new DataTransfer();
        clipboardData.setData("text/html", html);
        document.querySelector("#sheet-container")!.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await page.waitForFunction(() =>
        document.querySelector("#toast")?.textContent?.includes("已粘贴 18 张"),
      );
      assert.ok(peak > 1 && peak <= 6);
      assert.equal(
        requests,
        11,
        "duplicate URLs share a download, including failures",
      );
      await page.click('[data-action="parse-sheet"]');
      await page.locator(".parse-advanced summary").click();
      await page.selectOption("#parse-layout", "three");
      await page.click('[data-action="confirm-parse"]');
      await page.waitForFunction(
        () => !document.querySelector<HTMLDialogElement>("#modal")?.open,
      );
      await page.waitForFunction(
        () =>
          document.querySelector("#save-status")?.textContent ===
          "已保存数据",
      );
      const imported = (await f.workflows.repo.view()).products.find(
        (p) => p.code === "FAST-01",
      )!;
      assert.equal(imported.name, "合并产品");
      assert.equal(imported.tasks[0].prompt, "尺寸手动提示");
      assert.equal(imported.tasks[1].references.length, 0);
      assert.equal(imported.tasks[2].prompt, "细节手动提示");
      assert.equal(
        await f.workflows.assets.providerSource(
          imported.tasks[0].references[0],
        ),
        images[0],
      );
      assert.equal(
        await f.workflows.assets.providerSource(
          imported.tasks[2].references[0],
        ),
        images[1],
      );
    } finally {
      await browser.close();
      await f.close();
    }
  },
);

test(
  "inline prompt save regenerates only its card using the saved draft, with compact editing and cancellation",
  { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 30000 },
  async () => {
    const { chromium } = createRequire(import.meta.url)(
      process.env.PLAYWRIGHT_MODULE!,
    );
    const f = await fixture(resolve("dist"));
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
        value: "原始提示词",
      },
    ]);
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
    });
    try {
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      await page.goto(root);
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      const card = page.locator(".task-card").first();
      await card.waitFor();
      const dimensions = await card.evaluate((node: HTMLElement) => {
        const a = node.querySelector(".reference")!.getBoundingClientRect(),
          b = node.querySelector(".result-area")!.getBoundingClientRect();
        return [a.width, a.height, b.width, b.height];
      });
      assert.ok(
        dimensions.every(
          (value: number) => Math.abs(value - dimensions[0]) < 1,
        ),
      );
      assert.equal(
        await card
          .locator(".reference img")
          .evaluate(
            (node: HTMLImageElement) => getComputedStyle(node).objectFit,
          ),
        "contain",
      );
      await card.locator(".prompt-preview-text").click();
      const editor = card.locator(".inline-prompt-form textarea");
      await editor.fill("点击编辑后写入的手动提示词");
      await Promise.all([
        page.waitForResponse(
          (response: any) =>
            response.url().includes("/api/workspace/changes?") &&
            response.request().method() === "GET",
        ),
        page.evaluate(() =>
          document.dispatchEvent(new Event("visibilitychange")),
        ),
      ]);
      assert.equal(await editor.inputValue(), "点击编辑后写入的手动提示词");
      const untouched = (await f.workflows.repo.view()).products[0].tasks.slice(
        1,
      );
      const imageRequest = page.waitForRequest(
        (request: any) =>
          request.url().endsWith("/api/jobs") && request.method() === "POST",
      );
      await card
        .getByRole("button", { name: "保存并重新生成", exact: true })
        .click();
      const submitted = (await imageRequest).postDataJSON();
      assert.equal(submitted.kind, "image");
      assert.deepEqual(submitted.pairs, pairs(f.product).slice(0, 1));
      await editor.waitFor({ state: "detached" });
      assert.equal(
        (await f.workflows.repo.view()).products[0].tasks[0].prompt,
        "点击编辑后写入的手动提示词",
      );
      const calls = counts(),
        provider = fakeProvider(calls),
        submit = provider.submit;
      provider.submit = async (...args) => {
        assert.equal(args[0], "点击编辑后写入的手动提示词");
        return submit(...args);
      };
      const worker = new Worker(f.workflows, provider);
      await worker.step();
      await f.due();
      await worker.step();
      const generated = await f.workflows.repo.view();
      assert.equal(generated.jobs.length, 1);
      assert.equal(
        generated.products[0].tasks[0].versions[0].prompt,
        "点击编辑后写入的手动提示词",
      );
      assert.deepEqual(generated.products[0].tasks.slice(1), untouched);
      assert.deepEqual(calls, { analyze: 0, submit: 1, query: 1 });
      await card.locator(".prompt-preview-text").click();
      await editor.fill("取消的修改");
      await card.getByRole("button", { name: "取消", exact: true }).click();
      assert.equal(
        (await f.workflows.repo.view()).products[0].tasks[0].prompt,
        "点击编辑后写入的手动提示词",
      );
      assert.equal((await f.workflows.repo.view()).jobs.length, 1);
      await page.reload();
      await card.locator(".prompt-preview-text").waitFor();
      assert.equal(
        await card.locator(".prompt-preview-text").innerText(),
        "点击编辑后写入的手动提示词",
      );
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.locator("#mobile-product").isVisible(), true);
      assert.equal(
        await page.locator("#mobile-product").inputValue(),
        f.product.id,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
      const mobile = await card.evaluate((node: HTMLElement) => {
        const a = node.querySelector(".reference")!.getBoundingClientRect(),
          b = node.querySelector(".result-area")!.getBoundingClientRect();
        return [a.width, a.height, b.width, b.height];
      });
      assert.ok(
        mobile.every((value: number) => Math.abs(value - mobile[0]) < 1),
      );
      await card.locator(".prompt-preview-text").click();
      const headerFits = await card
        .locator(".prompt-preview-heading")
        .evaluate((node: HTMLElement) => {
          const bounds = node.getBoundingClientRect();
          return [...node.querySelectorAll("button")].every((button) => {
            const rect = button.getBoundingClientRect();
            return (
              rect.left >= bounds.left &&
              rect.right <= bounds.right &&
              rect.bottom <= bounds.bottom
            );
          });
        });
      assert.equal(headerFits, true);
      await card.getByRole("button", { name: "取消", exact: true }).click();
    } finally {
      await browser.close();
      await f.close();
    }
  },
);

test(
  "prompt save failures never generate and generation failures preserve the saved prompt and editor",
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
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const page = await browser.newPage();
      await page.goto(root);
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      const card = page.locator(".task-card").first();
      await card
        .getByRole("button", { name: "点击编写提示词", exact: true })
        .click();
      const editor = card.locator(".inline-prompt-form textarea"),
        save = card.getByRole("button", {
          name: "保存并重新生成",
          exact: true,
        });
      await editor.fill("   ");
      assert.equal(await save.isDisabled(), true);
      let generationRequests = 0;
      await page.route("**/api/jobs", (route: any) => {
        generationRequests++;
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "生成服务暂时不可用" }),
        });
      });
      await editor.fill("已保存但未能生成的提示词");
      await save.click();
      await card
        .getByRole("alert")
        .filter({ hasText: "提示词已保存，未能启动生成" })
        .waitFor();
      assert.equal(await editor.inputValue(), "已保存但未能生成的提示词");
      assert.equal(
        (await f.workflows.repo.view()).products[0].tasks[0].prompt,
        "已保存但未能生成的提示词",
      );
      assert.equal(generationRequests, 1);
      assert.equal(await save.isEnabled(), true);
      await page.route("**/api/workspace", (route: any) =>
        route.request().method() === "PATCH"
          ? route.fulfill({
              status: 500,
              contentType: "application/json",
              body: JSON.stringify({ error: "保存失败" }),
            })
          : route.continue(),
      );
      await editor.fill("保存失败的本地草稿");
      await save.click();
      await card.getByRole("alert").filter({ hasText: "保存失败" }).waitFor();
      assert.equal(generationRequests, 1);
      assert.equal(await editor.inputValue(), "保存失败的本地草稿");
      assert.equal(
        (await f.workflows.repo.view()).products[0].tasks[0].prompt,
        "已保存但未能生成的提示词",
      );
      assert.equal((await f.workflows.repo.view()).jobs.length, 0);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
