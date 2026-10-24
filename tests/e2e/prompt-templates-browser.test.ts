import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fixture, password } from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";

test(
  "simple text editor supports templates, draft recovery, replacement, latest saves and narrow screens",
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
        viewport: { width: 1440, height: 1050 },
      });
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(e.message));
      await page.goto(
        `http://127.0.0.1:${(f.app.server.address() as any).port}`,
      );
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      const open = () =>
        page
          .locator(".product-requirements")
          .getByRole("button", { name: "编辑要求", exact: true })
          .click();
      const editor = page.locator("#product-requirements");
      const save = page.getByRole("button", {
        name: "保存当前产品要求",
        exact: true,
      });
      await open();
      const content = "暖白背景，暖白留白。产品比例不变。尺寸 1200×800。";
      await editor.fill(content);
      await page
        .locator(".requirements-header")
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await open();
      assert.equal(await editor.inputValue(), content);
      await page.reload();
      await open();
      assert.equal(await editor.inputValue(), content);
      await page
        .getByRole("button", { name: "存为模板…", exact: true })
        .click();
      await page.locator("#requirement-template-name").fill("家居暖色");
      await page.getByRole("button", { name: "保存模板", exact: true }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "模板已保存" })
        .waitFor();
      let state = await f.workflows.repo.view();
      const template: any = Object.values(state.promptTemplates)[0];
      assert.equal(template.content, content);
      assert.equal(
        state.products[0].promptRequirements,
        null,
        "saving a template does not apply it",
      );
      await page.getByRole("button", { name: "查找替换", exact: true }).click();
      await page
        .getByRole("textbox", { name: "查找内容", exact: true })
        .fill("暖白");
      await page
        .getByRole("textbox", { name: "替换为", exact: true })
        .fill("冷灰");
      await page.getByRole("button", { name: "全部替换", exact: true }).click();
      assert.equal(
        await editor.inputValue(),
        content.replaceAll("暖白", "冷灰"),
      );
      await page.getByRole("button", { name: "撤销替换", exact: true }).click();
      assert.equal(await editor.inputValue(), content);
      await page.selectOption("#requirement-template", "default");
      await page.getByRole("button", { name: "撤销替换", exact: true }).click();
      assert.equal(await editor.inputValue(), content);
      await page.selectOption(
        "#requirement-template",
        `template:${template.id}`,
      );
      await editor.fill(`${content}\n文字使用英文。`);
      await page
        .getByRole("button", { name: "保存模板…", exact: true })
        .click();
      await page.locator("#requirement-template-name").fill("家居英文");
      await page.getByRole("button", { name: "更新模板", exact: true }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "模板已保存" })
        .waitFor();
      assert.equal(
        (await f.workflows.repo.view()).promptTemplates[template.id].name,
        "家居英文",
      );
      const final = await editor.inputValue();
      await editor.fill(
        `${state.common}\n补充要求：暖白背景，产品保持实拍比例。`,
      );
      await page
        .getByRole("button", { name: "关闭查找替换", exact: true })
        .click();
      const normal = await page.evaluate(() => {
        const luminance = (color: string) => {
          const rgb = color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
            .map((channel) => {
              const value = channel / 255;
              return value <= 0.04045
                ? value / 12.92
                : ((value + 0.055) / 1.055) ** 2.4;
            });
          return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
        };
        const dialog = document.querySelector<HTMLDialogElement>("#modal")!;
        const text = document.querySelector<HTMLTextAreaElement>(
          "#product-requirements",
        )!;
        const button = document.querySelector<HTMLButtonElement>(
          '[aria-label="保存当前产品要求"]',
        )!;
        const tool = document.querySelector<HTMLButtonElement>(
          '[aria-label="放大编辑"]',
        )!;
        const feedback = document.querySelector<HTMLElement>(
          ".requirements-feedback",
        )!;
        return {
          outerScroll: dialog.scrollHeight > dialog.clientHeight,
          textRatio:
            text.getBoundingClientRect().height /
            dialog.getBoundingClientRect().height,
          textColor: getComputedStyle(text).color,
          helperColor: getComputedStyle(feedback).color,
          contentContrast:
            1.05 / (luminance(getComputedStyle(text).color) + 0.05),
          helperContrast:
            1.05 / (luminance(getComputedStyle(feedback).color) + 0.05),
          saveColor: getComputedStyle(button).backgroundColor,
          toolColor: getComputedStyle(tool).backgroundColor,
          buttonHeight: button.getBoundingClientRect().height,
          toolbarHeight: document
            .querySelector(".requirements-toolbar")!
            .getBoundingClientRect().height,
          textScroll: text.scrollHeight > text.clientHeight,
          scrollbar: getComputedStyle(text).scrollbarWidth,
        };
      });
      assert.equal(normal.outerScroll, false);
      assert.ok(normal.textRatio > 0.75, JSON.stringify(normal));
      assert.notEqual(normal.textColor, normal.helperColor);
      assert.ok(normal.contentContrast >= 7);
      assert.ok(normal.helperContrast >= 4.5);
      assert.notEqual(normal.saveColor, normal.toolColor);
      assert.ok(normal.buttonHeight <= 30);
      assert.ok(normal.toolbarHeight <= 50);
      assert.equal(normal.textScroll, true);
      assert.equal(normal.scrollbar, "none");
      await editor.evaluate((el: HTMLTextAreaElement) => {
        el.scrollTop = 0;
      });
      await page.screenshot({ path: artifactPath("prompt-rules-compact.png") });
      await page.getByRole("button", { name: "放大编辑", exact: true }).click();
      assert.equal(
        await page.locator(".requirements-editor-expanded").count(),
        1,
      );
      assert.equal(await page.locator(".requirements-template-bar").count(), 0);
      assert.equal(await page.locator(".requirements-footer").count(), 0);
      for (const [width, height] of [
        [1440, 1050],
        [768, 700],
        [390, 844],
        [320, 568],
      ]) {
        await page.setViewportSize({ width, height });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
          `page at ${width}`,
        );
        assert.equal(
          await page
            .locator("#modal")
            .evaluate((el: HTMLElement) => el.scrollWidth <= el.clientWidth),
          true,
          `dialog at ${width}`,
        );
        const full = await page
          .locator("#modal")
          .evaluate((el: HTMLElement) => {
            const rect = el.getBoundingClientRect();
            const text = el.querySelector<HTMLTextAreaElement>("textarea")!;
            return {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              viewportWidth: innerWidth,
              viewportHeight: innerHeight,
              scroll: el.scrollHeight > el.clientHeight,
              ratio: text.getBoundingClientRect().height / innerHeight,
            };
          });
        assert.deepEqual(
          [full.x, full.y, full.width, full.height],
          [0, 0, full.viewportWidth, full.viewportHeight],
        );
        assert.equal(full.scroll, false, `fullscreen scroll at ${width}`);
        assert.ok(full.ratio > 0.8, JSON.stringify(full));
      }
      await page.setViewportSize({ width: 1440, height: 1050 });
      await editor.evaluate((el: HTMLTextAreaElement) => {
        el.scrollTop = 0;
      });
      await page.screenshot({
        path: artifactPath("prompt-rules-fullscreen.png"),
      });
      await page.keyboard.press("Escape");
      assert.equal(
        await page
          .locator("#modal")
          .evaluate((el: HTMLDialogElement) => el.open),
        true,
      );
      assert.equal(
        await page.locator(".requirements-editor-expanded").count(),
        0,
      );
      for (const [width, height] of [
        [768, 700],
        [390, 844],
        [320, 568],
      ]) {
        await page.setViewportSize({ width, height });
        const layout = await page
          .locator("#modal")
          .evaluate((el: HTMLElement) => ({
            horizontal: el.scrollWidth > el.clientWidth,
            vertical: el.scrollHeight > el.clientHeight,
            toolbar: el
              .querySelector(".requirements-toolbar")!
              .getBoundingClientRect().height,
          }));
        assert.deepEqual(
          [layout.horizontal, layout.vertical],
          [false, false],
          `compact modal overflow at ${width}`,
        );
        assert.ok(
          layout.toolbar <= 50,
          `toolbar wraps at ${width}: ${layout.toolbar}`,
        );
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await editor.evaluate((el: HTMLTextAreaElement) => {
        el.scrollTop = 0;
      });
      await page.screenshot({ path: artifactPath("prompt-rules-mobile.png") });
      await page.setViewportSize({ width: 1440, height: 1050 });
      await page.screenshot({
        path: artifactPath("prompt-templates-editor.png"),
      });
      await editor.fill(final);
      await page.getByRole("button", { name: "放大编辑", exact: true }).click();
      await page.keyboard.press("Control+s");
      await page.waitForFunction(
        () => !document.querySelector<HTMLDialogElement>("#modal")?.open,
      );
      assert.equal(
        (await f.workflows.repo.view()).products[0].promptRequirements,
        final,
      );
      await open();
      assert.equal(await editor.inputValue(), final);
      assert.equal(await save.isDisabled(), true);
      await page.selectOption(
        "#requirement-template",
        `template:${template.id}`,
      );
      await page
        .getByRole("button", { name: "保存模板…", exact: true })
        .click();
      await page.getByRole("button", { name: "删除模板", exact: true }).click();
      await page.getByRole("button", { name: "确定删除", exact: true }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "模板已删除" })
        .waitFor();
      assert.deepEqual((await f.workflows.repo.view()).promptTemplates, {});
      assert.equal(await editor.inputValue(), final);
      const latest = "另一个页面保存的内容";
      await f.workflows.edit([
        {
          path: ["products", f.product.id, "promptRequirements"],
          before: final,
          value: latest,
        },
      ]);
      await editor.fill("当前窗口未保存的编辑");
      await save.click();
      await page.waitForFunction(
        () => !document.querySelector<HTMLDialogElement>("#modal")?.open,
      );
      assert.equal(
        (await f.workflows.repo.view()).products[0].promptRequirements,
        "当前窗口未保存的编辑",
      );
      await open();
      assert.equal(await editor.inputValue(), "当前窗口未保存的编辑");
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
