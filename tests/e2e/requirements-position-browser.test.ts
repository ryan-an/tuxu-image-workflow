import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fixture, password } from "../support/production.js";
import { newProduct } from "../../shared/model.js";
import { editable } from "../../shared/workspace-edits.js";

test(
  "requirements restore cursor, selection and scroll after closing, saving and reload, independently per product and template",
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
      const content = Array.from(
        { length: 160 },
        (_, index) =>
          `第 ${index + 1} 行要求：保留产品外观，采用简洁布局和暖色背景。`,
      ).join("\n");
      const other = {
        ...newProduct("POSITION-OTHER", "另一产品"),
        promptRequirements: content,
      };
      const template = {
        id: "position-template",
        name: "编辑位置模板",
        content: content.replaceAll("暖色", "冷色"),
        updatedAt: Date.now(),
      };
      await f.workflows.edit([
        {
          path: ["products", f.product.id, "promptRequirements"],
          before: null,
          value: content,
        },
        {
          path: ["products", other.id],
          before: null,
          value: editable({ products: [other] }).products[other.id],
        },
        {
          path: ["promptTemplates", template.id],
          before: null,
          value: template,
        },
      ]);
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      page.setDefaultTimeout(8000);
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(
        `http://127.0.0.1:${(f.app.server.address() as any).port}`,
      );
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      const editor = page.locator("#product-requirements");
      const choice = page.locator("#requirement-template");
      const open = () =>
        page
          .locator(".product-requirements")
          .getByRole("button", { name: "编辑要求", exact: true })
          .click();
      const close = () =>
        page
          .locator(".requirements-header")
          .getByRole("button", { name: "关闭", exact: true })
          .click();
      const switchProduct = (id: string) =>
        page
          .locator(
            `#sidebar-content [data-action="open-product"][data-id="${id}"]`,
          )
          .click();
      const position = () =>
        editor.evaluate((element: HTMLTextAreaElement) => ({
          start: element.selectionStart,
          end: element.selectionEnd,
          direction: element.selectionDirection,
          scrollTop: element.scrollTop,
        }));
      const setPosition = async (
        start: number,
        end = start,
        scrollTop = 1200,
      ) => {
        await editor.focus();
        await editor.evaluate(
          (element: HTMLTextAreaElement, next: number[]) => {
            element.setSelectionRange(next[0], next[1], "backward");
            element.scrollTop = next[2];
            return new Promise<void>((done) =>
              requestAnimationFrame(() => requestAnimationFrame(() => done())),
            );
          },
          [start, end, scrollTop],
        );
        return position();
      };
      const expectPosition = (expected: Awaited<ReturnType<typeof position>>) =>
        page.waitForFunction((next: typeof expected) => {
          const element = document.querySelector<HTMLTextAreaElement>(
            "#product-requirements",
          );
          return (
            element !== null &&
            element.selectionStart === next.start &&
            element.selectionEnd === next.end &&
            element.selectionDirection === next.direction &&
            Math.abs(element.scrollTop - next.scrollTop) <= 1
          );
        }, expected);

      await switchProduct(f.product.id);
      await open();
      await setPosition(content.indexOf("第 60 行"));
      await page.keyboard.insertText("补充");
      const caret = await position();
      const draft = await editor.inputValue();
      assert.ok(caret.scrollTop > 0);
      await page.keyboard.press("Escape");
      await open();
      await expectPosition(caret);
      assert.equal(await editor.inputValue(), draft);
      assert.equal(
        await editor.evaluate(
          (element: Element) => document.activeElement === element,
        ),
        true,
      );

      const selection = await setPosition(
        draft.indexOf("第 80 行"),
        draft.indexOf("第 80 行") + 10,
        1800,
      );
      await close();
      await open();
      await expectPosition(selection);
      await page.reload();
      await switchProduct(f.product.id);
      await open();
      await expectPosition(selection);
      await page
        .getByRole("button", { name: "保存当前产品要求", exact: true })
        .click();
      await page.waitForFunction(
        () => !document.querySelector<HTMLDialogElement>("#modal")?.open,
      );
      await open();
      await expectPosition(selection);

      await choice.selectOption(`template:${template.id}`);
      const templatePosition = await setPosition(
        content.indexOf("第 30 行"),
        undefined,
        600,
      );
      await choice.selectOption("");
      await expectPosition(selection);
      await choice.selectOption(`template:${template.id}`);
      await expectPosition(templatePosition);
      await page
        .getByRole("button", { name: "保存当前产品要求", exact: true })
        .click();
      await page.waitForFunction(
        () => !document.querySelector<HTMLDialogElement>("#modal")?.open,
      );

      await switchProduct(other.id);
      await open();
      await expectPosition({
        start: 0,
        end: 0,
        direction: "forward",
        scrollTop: 0,
      });
      const otherPosition = await setPosition(
        content.indexOf("第 100 行"),
        undefined,
        2400,
      );
      await close();
      await switchProduct(f.product.id);
      await open();
      await expectPosition(templatePosition);
      await close();
      await switchProduct(other.id);
      await open();
      await expectPosition(otherPosition);
      await close();

      await f.workflows.edit([
        {
          path: ["products", f.product.id, "promptRequirements"],
          before: template.content,
          value: "短要求",
        },
      ]);
      await page.reload();
      await switchProduct(f.product.id);
      await open();
      await expectPosition({
        start: 3,
        end: 3,
        direction: templatePosition.direction,
        scrollTop: 0,
      });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
