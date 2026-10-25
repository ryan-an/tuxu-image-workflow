import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fixture, password, png } from "../support/production.js";
import { Members } from "../../server/production/members.js";
import { artifactPath } from "../support/artifacts.cjs";

test(
  "dialogs align confirmation actions right and dismiss only deliberate backdrop clicks",
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
      const product = (await f.workflows.repo.view()).products[0];
      product.tasks[0].prompt = "测试提示词";
      product.tasks[0].versions = [
        {
          id: "dialog-version",
          source: await f.workflows.assets.normalize(png),
          prompt: "历史提示词",
          number: 1,
          createdAt: Date.now(),
          origin: "generated",
        },
      ];
      product.tasks[0].primaryId = "dialog-version";
      await f.workflows.repo.saveProduct(f.db, product);
      await new Members(f.db).create({
        username: "dialog-editor",
        displayName: "弹窗测试",
        role: "editor",
        monthlyLimit: null,
        password,
      });
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

      async function checkConfirm(selector: string) {
        const button = page.locator(selector);
        await button.scrollIntoViewIfNeeded();
        const placement = await button.evaluate((element: HTMLElement) => {
          const bounds = element.getBoundingClientRect();
          const dialog = element.closest("dialog")!;
          const shell = dialog.getBoundingClientRect();
          return {
            right: bounds.right,
            left: bounds.left,
            bottom: bounds.bottom,
            dialogRight: shell.right,
            dialogLeft: shell.left,
            dialogBottom: shell.bottom,
            overflow: dialog.scrollWidth > dialog.clientWidth,
          };
        });
        assert.ok(
          placement.right > (placement.dialogLeft + placement.dialogRight) / 2,
        );
        assert.ok(
          placement.dialogRight - placement.right <= 36,
          JSON.stringify(placement),
        );
        assert.ok(
          placement.bottom <= placement.dialogBottom,
          JSON.stringify(placement),
        );
        assert.equal(placement.overflow, false);
      }
      const cases = [
        ["edit-product", '#product-form button[type="submit"]'],
        ["settings", '#settings-form button[type="submit"]'],
        ["edit-prompt", '#prompt-form button[type="submit"]'],
        ["manage-photos", '.media-modal-footer [data-action="close-modal"]'],
        [
          "manage-references",
          '.media-modal-footer [data-action="close-modal"]',
        ],
        ["view-version", '[data-action="modal-primary"]'],
        ["common-prompt", '[aria-label="保存当前产品要求"]'],
      ];
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const [action, confirm] of cases) {
          await page.locator(`[data-action="${action}"]`).first().click();
          await checkConfirm(confirm);
          const dialog = page.locator("#modal");
          await dialog.locator("h2").click();
          const bounds = await dialog.boundingBox();
          await page.mouse.click(bounds!.x + 2, bounds!.y + 2);
          assert.equal(
            await dialog.evaluate((element: HTMLDialogElement) => element.open),
            true,
          );
          await page.mouse.click(4, 4);
          await page.waitForFunction(
            () => !(document.querySelector("#modal") as HTMLDialogElement).open,
          );
        }
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.locator('[data-action="edit-product"]').click();
      const textarea = page.locator("#product-form textarea");
      const area = await textarea.boundingBox();
      await page.mouse.move(area!.x + 20, area!.y + 20);
      await page.mouse.down();
      await page.mouse.move(4, 4);
      await page.mouse.up();
      assert.equal(
        await page
          .locator("#modal")
          .evaluate((element: HTMLDialogElement) => element.open),
        true,
      );
      await page.screenshot({
        path: artifactPath("dialog-product-actions-right.png"),
      });
      await page.keyboard.press("Escape");

      await page.locator('[data-action="common-prompt"]').click();
      await page.getByRole("button", { name: "放大编辑", exact: true }).click();
      await checkConfirm('[aria-label="保存当前产品要求"]');
      await page.keyboard.press("Escape");
      await page.mouse.click(4, 4);

      await page.locator('[data-action="view"][data-view="sheet"]').click();
      await page.locator("#sheet-container canvas").first().waitFor();
      for (const [action, confirm] of [
        ["parse-sheet", '[data-action="confirm-parse"]'],
      ]) {
        await page.locator(`[data-action="${action}"]`).click();
        await checkConfirm(confirm);
        await page.mouse.click(4, 4);
        await page.waitForFunction(
          () => !(document.querySelector("#modal") as HTMLDialogElement).open,
        );
      }

      await page.locator(".sidebar .workspace-switcher-trigger").click();
      await page
        .getByRole("menuitem", { name: "新建工作区", exact: true })
        .click();
      await checkConfirm('.workspace-create-dialog button[type="submit"]');
      await page.mouse.click(4, 4);
      await page
        .locator(".workspace-create-dialog")
        .waitFor({ state: "detached" });

      const member = await browser.newPage();
      await member.goto(root);
      await member.fill("#login-username", "dialog-editor");
      await member.fill("#login-password", password);
      await member.click('#login-form button[type="submit"]');
      await member
        .getByRole("button", { name: "账号菜单", exact: true })
        .click();
      await member
        .getByRole("button", { name: "修改密码", exact: true })
        .click();
      const passwordButton = member.locator(
        '.password-form button[type="submit"]',
      );
      const passwordPlacement = await passwordButton.evaluate(
        (button: HTMLElement) => ({
          right: button.getBoundingClientRect().right,
          dialogRight: button.closest("dialog")!.getBoundingClientRect().right,
        }),
      );
      assert.ok(passwordPlacement.dialogRight - passwordPlacement.right <= 36);
      await member.mouse.click(4, 4);
      await member.locator(".password-form").waitFor({ state: "detached" });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
