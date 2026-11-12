import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fixture, password } from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";

test(
  "shared selects support styled pickers, keyboard cancellation, disabled options, grouped forms and narrow screens",
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
      const templates = Array.from({ length: 24 }, (_, index) => ({
        id: `style_${index}`,
        name:
          index === 23
            ? "自然暖白与柔和灰绿的家居生活场景，统一整套设计风格并完整保留产品的外观和规格"
            : `${["自然暖白 · 家居留白", "柔和灰绿 · 清新生活", "深色质感 · 精致细节", "明亮简约 · 产品展示"][index % 4]} ${index + 1}`,
        content: `模板 ${index + 1} 的独立要求`,
        updatedAt: 24 - index,
      }));
      await f.workflows.edit([
        ...templates.map((template) => ({
          path: ["promptTemplates", template.id],
          before: null,
          value: template,
        })),
        {
          path: ["products", f.product.id, "promptRequirements"],
          before: null,
          value: "保留已删除来源模板的正文",
        },
        {
          path: ["products", f.product.id, "promptTemplateId"],
          before: null,
          value: "deleted",
        },
      ]);
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(
        `http://127.0.0.1:${(f.app.server.address() as any).port}`,
      );
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      await page
        .locator(".product-requirements")
        .getByRole("button", { name: "编辑要求", exact: true })
        .click();
      const select = page.getByRole("combobox", {
        name: "套用模板",
        exact: true,
      });
      const editor = page.locator("#product-requirements");
      assert.equal(
        await select.locator('option[value="template:deleted"]').isDisabled(),
        true,
      );
      assert.equal(
        await select.evaluate((el: HTMLSelectElement) =>
          el.labels?.[0].textContent?.trim(),
        ),
        "套用模板",
      );
      assert.equal(
        await select.evaluate((el: Element) => getComputedStyle(el).appearance),
        "base-select",
      );
      await select.click();
      await page.waitForFunction(() =>
        document.querySelector("#requirement-template")?.matches(":open"),
      );
      const picker = await select.evaluate((el: Element) => {
        const style = getComputedStyle(el, "::picker(select)");
        return {
          appearance: style.appearance,
          radius: style.borderRadius,
          maxHeight: style.maxHeight,
        };
      });
      assert.equal(picker.appearance, "base-select");
      assert.equal(picker.radius, "10px");
      assert.ok(parseFloat(picker.maxHeight) <= 360);
      await page.waitForFunction(
        () =>
          getComputedStyle(
            document.querySelector("#requirement-template")!,
            "::picker-icon",
          ).rotate === "180deg",
      );
      await page.keyboard.press("Home");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      assert.equal(
        await select.inputValue(),
        "template:style_0",
        "keyboard selection skips the disabled deleted source",
      );
      assert.equal(await editor.inputValue(), templates[0].content);
      await select.click();
      await page.waitForFunction(
        () =>
          getComputedStyle(
            document.querySelector("#requirement-template")!,
            "::picker-icon",
          ).rotate === "180deg",
      );
      await page.screenshot({
        path: artifactPath("select-templates-desktop.png"),
      });
      await page.keyboard.press("End");
      await page.keyboard.press("Escape");
      assert.equal(
        await select.inputValue(),
        "template:style_0",
        "Escape cancels the uncommitted selection",
      );
      assert.equal(
        await page
          .locator("#modal")
          .evaluate((el: HTMLDialogElement) => el.open),
        true,
      );
      assert.equal(
        await select.evaluate((el: Element) => document.activeElement === el),
        true,
      );
      await select.click();
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      assert.equal(await select.inputValue(), "template:style_23");
      const label = await select
        .locator("selectedcontent")
        .evaluate((el: HTMLElement) => ({
          width: el.clientWidth,
          scroll: el.scrollWidth,
          overflow: getComputedStyle(el).textOverflow,
        }));
      assert.equal(label.overflow, "ellipsis");
      assert.ok(
        label.scroll > label.width,
        "the long selected label is truncated within the control",
      );
      await select.click();
      const longOption = await select
        .locator('option[value="template:style_23"]')
        .boundingBox();
      assert.ok(
        longOption && longOption.height > 32,
        "long option labels wrap instead of being cut off",
      );
      await page.screenshot({ path: artifactPath("select-long-template.png") });
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 390, height: 844 });
      await select.selectOption("");
      await select.click();
      await page.waitForFunction(
        () =>
          getComputedStyle(
            document.querySelector("#requirement-template")!,
            "::picker-icon",
          ).rotate === "180deg",
      );
      const bounds = await select
        .locator("option")
        .first()
        .evaluate((el: Element) => ({
          left: el.getBoundingClientRect().left,
          right: el.getBoundingClientRect().right,
          viewport: innerWidth,
        }));
      assert.ok(
        bounds.left >= 0 && bounds.right <= bounds.viewport,
        JSON.stringify(bounds),
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: artifactPath("select-templates-mobile.png"),
      });
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.locator("#settings-button").click();
      await page.locator("#image-model").selectOption("gpt-image-2-vip");
      const size = page.locator('select[name="gptSize"]');
      assert.ok((await size.locator("optgroup").count()) > 1);
      const lastSize = await size
        .locator("option")
        .last()
        .getAttribute("value");
      await size.click();
      await page.waitForFunction(
        () =>
          getComputedStyle(
            document.querySelector('select[name="gptSize"]')!,
            "::picker-icon",
          ).rotate === "180deg",
      );
      await page.screenshot({ path: artifactPath("select-model-sizes.png") });
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      assert.equal(await size.inputValue(), lastSize);
      assert.equal(
        await page
          .locator("#settings-form")
          .evaluate((form: HTMLFormElement) =>
            new FormData(form).get("gptSize"),
          ),
        lastSize,
      );
      await size.focus();
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() =>
          document.activeElement?.matches(".ui-select-trigger"),
        ),
        false,
      );
      await size.evaluate((el: HTMLSelectElement) => {
        el.disabled = true;
      });
      assert.equal(await size.isDisabled(), true);
      assert.equal(
        await size.evaluate((el: Element) => getComputedStyle(el).cursor),
        "not-allowed",
      );
      await size.evaluate((el: HTMLSelectElement) => {
        el.disabled = false;
      });
      await page.emulateMedia({ forcedColors: "active" });
      assert.equal(
        await size.evaluate((el: Element) => getComputedStyle(el).appearance),
        "auto",
      );
      await size.selectOption("auto");
      assert.equal(await size.inputValue(), "auto");
      await page.emulateMedia({ forcedColors: "none" });
      await page.keyboard.press("Escape");
      await page.locator('[data-action="view"][data-view="queue"]').click();
      assert.equal(
        await page
          .getByRole("combobox", { name: "产品进度筛选" })
          .evaluate((el: Element) => getComputedStyle(el).appearance),
        "base-select",
      );
      await page
        .getByRole("combobox", { name: "产品进度筛选" })
        .selectOption("missing");
      await page.locator("#queue-tab-jobs").click();
      await page
        .getByRole("combobox", { name: "任务状态" })
        .selectOption("completed");
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
