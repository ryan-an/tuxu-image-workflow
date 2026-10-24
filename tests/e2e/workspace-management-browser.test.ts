import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fixture, password } from "../support/production.js";
import { Members } from "../../server/production/members.js";
import { artifactPath } from "../support/artifacts.cjs";

test(
  "a collaborator creates a personal workspace, invites an existing user, switches tabs, manages lifecycle and transfers ownership",
  { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 120000 },
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
      await new Members(f.db).create({
        username: "multi-person",
        displayName: "创作者",
        role: "viewer",
        monthlyLimit: null,
        password: "workspace-person-password",
      });
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      const page = await context.newPage(),
        errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(e.message));
      await page.goto(root);
      await page.fill("#login-username", "multi-person");
      await page.fill("#login-password", "workspace-person-password");
      await page.click('#login-form button[type="submit"]');
      await page.locator(".task-card").first().waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "成员管理", exact: true })
          .count(),
        0,
      );
      const switcher = page.locator(".sidebar .workspace-switcher-trigger");
      const menu = page.getByRole("menu", { name: "工作区列表", exact: true });
      await switcher.focus();
      await page.keyboard.press("ArrowDown");
      await menu.waitFor();
      await page.keyboard.press("End");
      assert.equal(
        await menu
          .getByRole("menuitem")
          .last()
          .evaluate((el: Element) => el === document.activeElement),
        true,
        "keyboard navigation reaches the final create action",
      );
      assert.equal(
        await menu.getByRole("menuitem").last().innerText(),
        "新建工作区",
      );
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "hidden" });
      await switcher.click();
      await menu
        .getByRole("menuitem", { name: "工作区管理", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "工作区管理", exact: true })
        .waitFor();
      assert.equal(await page.locator("#sidebar-content").isVisible(), true);
      assert.equal(
        await page.locator(".product-link").first().isVisible(),
        true,
      );
      assert.match(
        await page.locator(".workspace-current-context").innerText(),
        /默认团队/,
      );
      await page.locator(".product-link").first().click();
      await page.locator("#workbench-section").waitFor();
      assert.equal(new URL(page.url()).searchParams.has("manage"), false);
      await page
        .getByRole("button", { name: "工作区管理", exact: true })
        .click();
      await page.reload();
      await page
        .getByRole("heading", { name: "工作区管理", exact: true })
        .waitFor();
      await page
        .locator(".workspace-page-actions")
        .getByRole("button", { name: "返回工作台", exact: true })
        .click();
      await page.locator("#workbench-section").waitFor();
      const taskCount = await page.locator(".task-card").count();
      await switcher.click();
      await menu.getByRole("menuitem").last().click();
      const createDialog = page.getByRole("dialog", {
        name: "新建工作区",
        exact: true,
      });
      await createDialog
        .getByRole("textbox", { name: "工作区名称", exact: true })
        .fill("取消的新空间");
      await page.screenshot({
        path: artifactPath("workspace-create-dialog.png"),
        fullPage: true,
      });
      await createDialog
        .getByRole("button", { name: "取消", exact: true })
        .click();
      await createDialog.waitFor({ state: "hidden" });
      assert.equal(
        new URL(page.url()).searchParams.get("workspace"),
        "default",
      );
      assert.equal(await page.locator(".task-card").count(), taskCount);
      await switcher.click();
      await menu.getByRole("menuitem").last().click();
      await page
        .getByRole("textbox", { name: "工作区名称", exact: true })
        .fill("我的创作");
      await page
        .getByRole("button", { name: "创建工作区", exact: true })
        .click();
      await page.waitForURL(
        (url: URL) => url.searchParams.get("workspace") !== "default",
      );
      await page.locator("#app").waitFor();
      assert.equal(await page.locator(".task-card").count(), 0);
      const workspaceId = new URL(page.url()).searchParams.get("workspace")!;
      assert.notEqual(workspaceId, "default");
      await page.getByRole("button", { name: "成员管理", exact: true }).click();
      await page
        .getByRole("button", { name: "生成邀请链接", exact: true })
        .click();
      const link = page.getByRole("textbox", { name: "邀请链接", exact: true });
      await link.waitFor();
      const invitationUrl = await link.inputValue();
      const other = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      other.on("pageerror", (e: Error) => errors.push(e.message));
      await other.goto(root);
      await other.fill("#login-password", password);
      await other.click('#login-form button[type="submit"]');
      await other.locator("#app").waitFor();
      await other.goto(invitationUrl);
      await other
        .getByRole("button", { name: "确认加入", exact: true })
        .click();
      await other.locator("#app").waitFor();
      assert.equal(
        new URL(other.url()).searchParams.get("workspace"),
        workspaceId,
      );
      assert.equal(
        await other.locator("#settings-button").count(),
        0,
        "the existing owner is only an editor in this personal workspace",
      );
      const tab = await page.context().newPage();
      await tab.goto(`${root}/?workspace=${workspaceId}`);
      await tab.locator("#app").waitFor();
      await switcher.click();
      await menu.getByRole("menuitemradio", { name: /默认团队/ }).click();
      await page.locator(".task-card").first().waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "成员管理", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await tab
          .getByRole("button", { name: "切换工作区：我的创作", exact: true })
          .count(),
        1,
      );
      await page
        .getByRole("button", { name: "工作区管理", exact: true })
        .click();
      const card = page.locator(".workspace-card").filter({
        has: page.getByRole("heading", { name: "我的创作", exact: true }),
      });
      await card.getByRole("button", { name: "重命名", exact: true }).click();
      await card
        .getByRole("textbox", { name: "新的工作区名称", exact: true })
        .fill("个人产品库");
      await card.getByRole("button", { name: "保存名称", exact: true }).click();
      const renamed = page.locator(".workspace-card").filter({
        has: page.getByRole("heading", { name: "个人产品库", exact: true }),
      });
      await renamed.getByRole("button", { name: "归档", exact: true }).click();
      await renamed
        .getByRole("button", { name: "确认归档", exact: true })
        .click();
      await renamed.getByText("已归档", { exact: true }).waitFor();
      await renamed.getByRole("button", { name: "恢复", exact: true }).click();
      await renamed
        .getByRole("button", { name: "确认恢复", exact: true })
        .click();
      await renamed
        .getByRole("button", { name: "进入工作区", exact: true })
        .waitFor();
      assert.equal(await page.locator("#sidebar-content").isVisible(), true);
      await page.screenshot({
        path: artifactPath("workspace-management-desktop.png"),
        fullPage: true,
      });
      await switcher.click();
      await menu.getByRole("menuitemradio", { name: /默认团队/ }).waitFor();
      assert.equal(
        await menu
          .getByRole("menuitemradio", { name: /默认团队/ })
          .getAttribute("aria-checked"),
        "true",
      );
      assert.equal(
        await menu.getByRole("menuitem").last().innerText(),
        "新建工作区",
      );
      await page.screenshot({
        path: artifactPath("workspace-switcher-desktop.png"),
        fullPage: true,
      });
      await page
        .getByRole("heading", { name: "工作区管理", exact: true })
        .click();
      await menu.waitFor({ state: "hidden" });
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
          `workspaces overflow at ${width}`,
        );
        await switcher.click();
        await menu.waitFor();
        const bounds = await menu.boundingBox();
        assert.ok(
          bounds && bounds.x >= 0 && bounds.x + bounds.width <= width,
          `workspace menu overflow at ${width}`,
        );
        if (width === 390)
          await page.screenshot({
            path: artifactPath("workspace-switcher-mobile.png"),
            fullPage: true,
          });
        await page.keyboard.press("Escape");
        await menu.waitFor({ state: "hidden" });
      }
      await page.screenshot({
        path: artifactPath("workspace-management-mobile.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await renamed
        .getByRole("button", { name: "进入工作区", exact: true })
        .click();
      await page.getByRole("button", { name: "成员管理", exact: true }).click();
      const member = page
        .locator(".account-member")
        .filter({ has: page.getByText("@admin", { exact: true }) });
      await member
        .getByRole("button", { name: "转让所有权", exact: true })
        .click();
      await page.getByRole("button", { name: "确认转让", exact: true }).click();
      await page.locator("#app").waitFor();
      await page
        .locator(".current-account")
        .getByText("编辑者", { exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "成员管理", exact: true })
          .count(),
        0,
      );
      await other.reload();
      await other
        .getByRole("button", { name: "成员管理", exact: true })
        .waitFor();
      await other
        .getByRole("button", { name: "成员管理", exact: true })
        .click();
      await other
        .getByRole("button", { name: "生成邀请链接", exact: true })
        .click();
      const newLink = other.getByRole("textbox", {
        name: "邀请链接",
        exact: true,
      });
      await newLink.waitFor();
      const newcomer = await browser.newPage({
        viewport: { width: 390, height: 844 },
      });
      newcomer.on("pageerror", (e: Error) => errors.push(e.message));
      await newcomer.goto(await newLink.inputValue());
      await newcomer.locator("#invite-username").fill("generic-new-person");
      await newcomer.locator("#invite-password").fill("new-person-password");
      await newcomer.locator("#invite-confirm").fill("new-person-password");
      await newcomer
        .getByRole("button", { name: "加入工作区", exact: true })
        .click();
      await newcomer.locator("#app").waitFor();
      assert.equal(
        new URL(newcomer.url()).searchParams.get("workspace"),
        workspaceId,
      );
      assert.equal(
        await newcomer
          .getByRole("button", { name: "成员管理", exact: true })
          .count(),
        0,
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
