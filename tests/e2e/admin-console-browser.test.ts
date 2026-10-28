import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { fixture, password } from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";
import { Admin } from "../../server/production/admin.js";

test(
  "super admin manages real accounts and nonmember workspaces, while ordinary users are refused",
  { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 120000 },
  async () => {
    const { chromium } = createRequire(import.meta.url)(
      process.env.PLAYWRIGHT_MODULE!,
    );
    const f = await fixture(resolve("dist"));
    const imageBytes = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#5b4fe8" },
    })
      .png()
      .toBuffer();
    const imageSource = `data:image/png;base64,${imageBytes.toString("base64")}`;
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
    });
    let page: any;
    try {
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(e.message));
      await page.goto(`${root}/admin`);
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      await page
        .getByRole("heading", { name: "用户管理", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "新建账号", exact: true }).click();
      const dialog = page.getByRole("dialog", {
        name: "新建账号",
        exact: true,
      });
      await dialog
        .getByLabel("用户名", { exact: true })
        .fill("admin-browser-owner");
      await dialog.getByLabel("个人名称", { exact: true }).fill("后台测试用户");
      await dialog
        .getByLabel("初始密码", { exact: true })
        .fill("admin-browser-password");
      await dialog
        .getByRole("button", { name: "创建账号", exact: true })
        .click();
      await dialog.waitFor({ state: "hidden" });
      const row = page
        .locator(".admin-table tbody tr")
        .filter({ hasText: "admin-browser-owner" });
      await row.waitFor();
      assert.match(await row.innerText(), /0 个/);
      await row.getByRole("button", { name: "查看详情", exact: true }).click();
      await page
        .getByRole("heading", { name: "后台测试用户", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "全局禁用账号", exact: true })
        .click();
      const disable = page.getByRole("dialog", {
        name: "全局禁用账号",
        exact: true,
      });
      assert.match(await disable.innerText(), /全部工作区访问/);
      await disable
        .getByRole("button", { name: "确认全局禁用", exact: true })
        .click();
      await disable.waitFor({ state: "hidden" });
      await page
        .getByRole("button", { name: "启用账号", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "启用账号", exact: true }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "确认启用", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page
        .getByRole("button", { name: "重置密码", exact: true })
        .waitFor();
      await page
        .getByRole("navigation", { name: "超级管理台导航" })
        .getByRole("button", { name: "工作区管理", exact: true })
        .click();
      await page
        .getByRole("button", { name: "新建工作区", exact: true })
        .click();
      const createSpace = page.getByRole("dialog", {
        name: "新建工作区",
        exact: true,
      });
      await createSpace
        .getByLabel("工作区名称", { exact: true })
        .fill("后台跨空间测试");
      await createSpace
        .getByLabel("指定所有者", { exact: true })
        .selectOption({ label: "后台测试用户 · @admin-browser-owner" });
      await createSpace
        .getByRole("button", { name: "创建工作区", exact: true })
        .click();
      await createSpace.waitFor({ state: "hidden" });
      await page
        .getByRole("heading", { name: "后台跨空间测试", exact: true })
        .waitFor();
      const workspaceId = new URL(page.url()).searchParams.get("workspace")!;
      assert.equal(
        await page
          .getByRole("button", { name: "并发配置", exact: true })
          .count(),
        0,
      );
      assert.ok(workspaceId);
      assert.equal(
        (
          await f.db.query(
            "SELECT account_id FROM workspace_members WHERE workspace_id=$1 AND account_id='owner'",
            [workspaceId],
          )
        ).rows.length,
        0,
      );
      await page.screenshot({
        path: artifactPath("admin-workspace-detail.png"),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "进入工作区", exact: true })
        .click();
      await page
        .getByRole("region", { name: "超级管理模式", exact: true })
        .waitFor();
      assert.equal(
        new URL(page.url()).searchParams.get("workspace"),
        workspaceId,
      );
      assert.equal(new URL(page.url()).searchParams.get("admin"), "1");
      await page
        .getByRole("button", { name: "添加第一个产品", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "成员管理", exact: true })
        .waitFor();
      assert.match(
        await page.locator(".admin-mode-banner").innerText(),
        /操作者：admin/,
      );
      await page
        .getByRole("button", { name: "添加第一个产品", exact: true })
        .click();
      await page
        .locator('#product-form input[name="code"]')
        .fill("ADMIN-PRODUCT");
      await page
        .locator('#product-form input[name="name"]')
        .fill("管理测试产品");
      await Promise.all([
        page.waitForResponse(
          (response: any) =>
            response.url().endsWith("/api/workspace") &&
            response.request().method() === "PATCH" &&
            response.request().postData()?.includes("ADMIN-PRODUCT"),
        ),
        page.getByRole("button", { name: "保存产品", exact: true }).click(),
      ]);
      const uploaded = await page.evaluate(
        async ({
          source,
          workspaceId,
        }: {
          source: string;
          workspaceId: string;
        }) => {
          const headers = {
            "Content-Type": "application/json",
            "X-Workspace-Id": workspaceId,
            "X-Admin-Mode": "1",
            "X-Account-Id": "owner",
          };
          const assetResponse = await fetch("/api/assets", {
            method: "POST",
            headers,
            body: JSON.stringify({ source }),
          });
          const asset = await assetResponse.json();
          if (!assetResponse.ok) throw new Error(asset.error);
          const workspace = await (
            await fetch("/api/workspace", { headers })
          ).json();
          const product = workspace.products.find(
            (p: { code: string }) => p.code === "ADMIN-PRODUCT",
          );
          const response = await fetch("/api/workspace", {
            method: "PATCH",
            headers,
            body: JSON.stringify({
              edits: [
                {
                  path: ["products", product.id, "photo"],
                  before: "",
                  value: asset.source,
                },
                {
                  path: ["products", product.id, "photos"],
                  before: [],
                  value: [asset.source],
                },
                {
                  path: [
                    "products",
                    product.id,
                    "tasks",
                    product.tasks[0].id,
                    "references",
                  ],
                  before: [],
                  value: [asset.source],
                },
              ],
            }),
          });
          if (!response.ok) throw new Error((await response.json()).error);
          return asset.source;
        },
        { source: imageSource, workspaceId },
      );
      assert.match(uploaded, /^\/api\/assets\//);
      await page.reload();
      await page.waitForFunction(() =>
        Array.from(
          document.querySelectorAll<HTMLImageElement>(
            'img[alt="管理测试产品实拍缩略图"]',
          ),
        ).some((img) => img.complete && img.naturalWidth > 0),
      );
      await page
        .getByRole("button", { name: "编辑产品", exact: true })
        .waitFor();
      await page.screenshot({
        path: artifactPath("admin-workspace-mode.png"),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "返回管理台", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "后台跨空间测试", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "归档工作区", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "确认归档", exact: true })
        .click();
      await page
        .getByRole("button", { name: "只读查看工作区", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "只读查看工作区", exact: true })
        .click();
      await page
        .getByRole("region", { name: "超级管理模式", exact: true })
        .waitFor();
      assert.match(
        await page.locator(".admin-mode-banner").innerText(),
        /归档只读/,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "编辑产品", exact: true })
          .count(),
        0,
      );
      await page
        .getByRole("button", { name: "查看产品", exact: true })
        .waitFor();
      await page.waitForFunction(() =>
        Array.from(
          document.querySelectorAll<HTMLImageElement>(
            'img[alt="管理测试产品实拍缩略图"]',
          ),
        ).some((img) => img.complete && img.naturalWidth > 0),
      );
      await page
        .getByRole("button", { name: "表格预览 / 导入", exact: true })
        .click();
      const originalLink = page
        .locator('.readonly-sheet a[rel="noreferrer"]')
        .first();
      await originalLink.waitFor();
      const originalUrl = new URL(
        await originalLink.getAttribute("href"),
        root,
      );
      assert.equal(originalUrl.pathname, uploaded);
      assert.equal(originalUrl.searchParams.get("workspace"), workspaceId);
      assert.equal(originalUrl.searchParams.get("admin"), "1");
      const [imagePage, imageResponse] = await Promise.all([
        context.waitForEvent("page"),
        context.waitForEvent("response", {
          predicate: (response: any) =>
            response.url() === originalUrl.href &&
            response.request().isNavigationRequest(),
        }),
        originalLink.click(),
      ]);
      assert.equal(imageResponse.status(), 200);
      assert.equal(imageResponse.request().headers().referer, undefined);
      await imagePage.waitForFunction(() =>
        Array.from(document.images).some(
          (image) => image.complete && image.naturalWidth > 0,
        ),
      );
      await imagePage.close();
      await page
        .getByRole("button", { name: "返回管理台", exact: true })
        .click();
      await page
        .getByRole("navigation", { name: "超级管理台导航" })
        .getByRole("button", { name: "操作记录", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "操作记录", exact: true })
        .waitFor();
      await page
        .locator(".admin-table tbody tr")
        .filter({ hasText: "新建" })
        .first()
        .waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: artifactPath("admin-audit-mobile.png"),
        fullPage: true,
      });

      const ordinary = await browser.newContext();
      const memberPage = await ordinary.newPage();
      await memberPage.goto(root);
      await memberPage.fill("#login-username", "admin-browser-owner");
      await memberPage.fill("#login-password", "admin-browser-password");
      await memberPage.click('#login-form button[type="submit"]');
      await memberPage.waitForURL((url: URL) => url.pathname !== "/login");
      await memberPage.goto(`${root}/admin`);
      await memberPage
        .getByRole("heading", { name: "无权访问超级管理台", exact: true })
        .waitFor();
      assert.equal(
        await memberPage
          .getByRole("button", { name: "新建账号", exact: true })
          .count(),
        0,
      );
      assert.deepEqual(errors, []);
      await ordinary.close();
      await context.close();
    } catch (error) {
      if (page && !page.isClosed()) {
        await page
          .screenshot({
            path: artifactPath("admin-console-failure.png"),
            fullPage: true,
            timeout: 5000,
          })
          .catch(() => {});
        await page
          .content()
          .then((html: string) =>
            writeFile(artifactPath("admin-console-failure.html"), html, "utf8"),
          )
          .catch(() => {});
      }
      throw error;
    } finally {
      await browser.close();
      await f.close();
    }
  },
);

test(
  "admin buttons retain their styles, navigation has icons, and account deletion confirms the username",
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
      const admin = new Admin(f.db, "owner", "browser-deletion-setup");
      const user = await admin.createAccount({
        username: "browser-delete-user",
        displayName: "删除流程测试",
        password: "browser-delete-password-123",
      });
      const owner = await admin.createAccount({
        username: "browser-owned-user",
        displayName: "有工作区的账号",
        password: "browser-owner-password-123",
      });
      await admin.createWorkspace({ name: "先转让所有权", ownerId: owner.id });
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      await page.goto(`${root}/admin?account=${user.id}`);
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      await page
        .getByRole("heading", { name: "用户管理", exact: true })
        .waitFor();
      await page.goto(`${root}/admin?account=${user.id}`);
      await page
        .getByRole("heading", { name: "删除流程测试", exact: true })
        .waitFor();
      assert.equal(
        await page
          .locator('.admin-sidebar nav button svg[aria-hidden="true"]')
          .count(),
        3,
      );
      const remove = page.getByRole("button", {
        name: "删除账号",
        exact: true,
      });
      const geometry = await remove.evaluate((el: HTMLElement) => {
        const css = getComputedStyle(el);
        return {
          height: el.getBoundingClientRect().height,
          padding: parseFloat(css.paddingLeft),
          display: css.display,
          color: css.color,
          background: css.backgroundColor,
        };
      });
      assert.ok(geometry.height >= 36 && geometry.padding >= 14);
      assert.ok(
        ["flex", "inline-flex"].includes(geometry.display),
        "button contents use flex layout, including blockified flex items",
      );
      assert.equal(geometry.color, "rgb(201, 47, 70)");
      assert.equal(geometry.background, "rgb(255, 240, 242)");
      await page.screenshot({
        path: artifactPath("admin-account-detail-styled.png"),
        fullPage: true,
      });
      await remove.click();
      const dialog = page.getByRole("dialog", {
        name: "删除账号",
        exact: true,
      });
      await dialog
        .getByLabel("输入用户名以确认删除", { exact: true })
        .fill("wrong-user");
      await dialog
        .getByRole("button", { name: "确认删除账号", exact: true })
        .click();
      await dialog.getByRole("alert").waitFor();
      assert.match(await dialog.getByRole("alert").innerText(), /完整用户名/);
      await dialog
        .getByLabel("输入用户名以确认删除", { exact: true })
        .fill("browser-delete-user");
      await page.screenshot({
        path: artifactPath("admin-delete-account-dialog.png"),
        fullPage: true,
      });
      await dialog
        .getByRole("button", { name: "确认删除账号", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "用户管理", exact: true })
        .waitFor();
      assert.equal(
        await page
          .locator(".admin-table tbody tr")
          .filter({ hasText: "browser-delete-user" })
          .count(),
        0,
      );
      assert.equal(
        (await f.db.query("SELECT status FROM accounts WHERE id=$1", [user.id]))
          .rows[0].status,
        "deleted",
      );
      await page.goto(`${root}/admin?account=${owner.id}`);
      await page.getByRole("button", { name: "删除账号", exact: true }).click();
      assert.equal(
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "确认删除账号", exact: true })
          .isDisabled(),
        true,
      );
      assert.match(
        await page.getByRole("dialog").innerText(),
        /先转让全部所有权/,
      );
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "取消", exact: true })
        .click();
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
      await page.screenshot({
        path: artifactPath("admin-account-mobile-styled.png"),
        fullPage: true,
      });
      await page.goto(`${root}/admin?account=owner`);
      await page
        .getByRole("heading", { name: "所有者", exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "删除账号", exact: true })
          .count(),
        0,
      );
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
