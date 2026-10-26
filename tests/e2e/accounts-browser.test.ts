import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fixture, password, png } from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";
import { Accounts } from "../../server/production/accounts.js";
import { Members } from "../../server/production/members.js";
import { Provisioning } from "../../server/production/provisioning.js";

test(
  "owner creates invitation, member activates, viewer downloads locally and editor has no owner controls",
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
      const source = await f.workflows.assets.normalize(png);
      const product = (await f.workflows.repo.view()).products[0];
      product.tasks[0].prompt = "只读查看的提示词";
      product.tasks[0].versions.push({
        id: "viewer-result",
        source,
        prompt: "生成提示词",
        origin: "generated",
        number: 1,
        createdAt: Date.now(),
      });
      product.tasks[0].primaryId = "viewer-result";
      product.tasks[0].selectedIds = [];
      await f.workflows.repo.saveProduct(f.db, product);
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const owner = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors: string[] = [];
      owner.on("pageerror", (e: Error) => errors.push(e.message));
      await owner.goto(root);
      await owner.fill("#login-password", password);
      await owner.click('#login-form button[type="submit"]');
      await owner
        .getByRole("button", { name: "成员管理", exact: true })
        .click();
      await owner
        .locator('.account-create [name="username"]')
        .fill("browser-viewer");
      await owner
        .locator('.account-create [name="displayName"]')
        .fill("浏览查看者");
      await owner
        .locator('.account-create [name="role"]')
        .selectOption("viewer");
      const quota = owner.locator('.account-create [name="monthlyLimit"]');
      assert.equal(await quota.isDisabled(), true);
      assert.equal(await quota.inputValue(), "不限");
      assert.equal(
        await owner
          .getByText(
            "团队管理员由开发者创建和重置密码，账号管理页只管理本团队成员。",
            { exact: true },
          )
          .count(),
        0,
      );
      await owner
        .getByRole("button", { name: "发送邀请", exact: true })
        .click();
      const link = owner.getByRole("textbox", {
        name: "邀请链接",
        exact: true,
      });
      await link.waitFor();
      assert.equal(
        (await new Members(f.db).list()).find(
          (account) => account.username === "browser-viewer",
        )?.monthlyLimit,
        null,
      );
      const inviteUrl = await link.inputValue();
      assert.match(inviteUrl, /\/invite#token=/);
      await owner
        .getByRole("button", { name: "编辑权限", exact: true })
        .click();
      const editQuota = owner.locator(
        '.account-edit-form [name="monthlyLimit"]',
      );
      assert.equal(await editQuota.isDisabled(), true);
      assert.equal(await editQuota.inputValue(), "不限");
      await owner.getByRole("button", { name: "保存", exact: true }).click();
      await owner.locator(".account-edit-form").waitFor({ state: "detached" });
      assert.equal(
        (await new Members(f.db).list()).find(
          (account) => account.username === "browser-viewer",
        )?.monthlyLimit,
        null,
      );
      await owner.screenshot({
        path: artifactPath("accounts-desktop.png"),
        fullPage: true,
      });
      for (const width of [1024, 390, 320]) {
        await owner.setViewportSize({ width, height: 1000 });
        assert.equal(
          await owner.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
          `accounts overflow at ${width}`,
        );
      }
      await owner.screenshot({
        path: artifactPath("accounts-mobile.png"),
        fullPage: true,
      });
      await owner.setViewportSize({ width: 1440, height: 1000 });
      const viewer = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        acceptDownloads: true,
      });
      viewer.on("pageerror", (e: Error) => errors.push(e.message));
      await viewer.goto(inviteUrl);
      await viewer.locator("#invite-username").waitFor();
      await viewer.screenshot({
        path: artifactPath("invitation-desktop.png"),
        fullPage: true,
      });
      await viewer.setViewportSize({ width: 320, height: 800 });
      await viewer.screenshot({
        path: artifactPath("invitation-mobile.png"),
        fullPage: true,
      });
      await viewer.setViewportSize({ width: 1440, height: 1000 });
      await viewer.locator("#invite-password").fill("viewer-browser-password");
      await viewer.locator("#invite-confirm").fill("viewer-browser-password");
      await viewer
        .getByRole("button", { name: "加入工作区", exact: true })
        .click();
      await viewer.locator(".task-card").first().waitFor();
      assert.equal(new URL(viewer.url()).hash, "");
      assert.equal(
        await viewer
          .getByRole("button", { name: "成员管理", exact: true })
          .count(),
        0,
      );
      assert.equal(await viewer.locator("#settings-button").count(), 0);
      assert.equal(
        await viewer
          .getByRole("button", { name: "添加产品", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await viewer.locator('[data-action="generate-image"]').count(),
        0,
      );
      await viewer
        .getByRole("button", { name: "查看产品", exact: true })
        .click();
      await viewer
        .locator("dialog[open]")
        .getByText("产品资料", { exact: true })
        .waitFor();
      assert.equal(await viewer.locator("#product-form").count(), 0);
      await viewer.keyboard.press("Escape");
      await viewer
        .getByRole("button", { name: "查看要求", exact: true })
        .click();
      assert.equal(
        await viewer
          .getByRole("textbox", { name: "生成要求（只读）" })
          .getAttribute("readonly"),
        "",
      );
      assert.equal(await viewer.locator("#common-form").count(), 0);
      await viewer.keyboard.press("Escape");
      await viewer.locator(".prompt-preview-text").first().click();
      assert.equal(await viewer.locator(".inline-prompt-form").count(), 0);
      await viewer
        .locator('.version-history input[type="checkbox"]')
        .first()
        .check();
      assert.equal(await viewer.locator("#download-current").isEnabled(), true);
      assert.deepEqual(
        (await f.workflows.repo.view()).products[0].tasks[0].selectedIds,
        [],
      );
      const download = viewer.waitForEvent("download");
      await viewer.locator("#download-current").click();
      await (await download).saveAs(artifactPath("viewer-results.zip"));
      await viewer.locator('[data-action="view"][data-view="queue"]').click();
      assert.equal(
        await viewer
          .locator('[data-action="download-batch-selected"]')
          .isEnabled(),
        true,
      );
      await viewer
        .locator('[data-action="view"][data-view="workbench"]')
        .click();
      await viewer.locator('[data-action="manage-photos"]').click();
      await viewer.locator("#media-uploader").waitFor();
      assert.equal(await viewer.locator("#media-dropzone").count(), 0);
      await viewer.keyboard.press("Escape");
      await viewer.locator('[data-action="view"][data-view="sheet"]').click();
      await viewer.locator(".readonly-sheet").waitFor();
      assert.equal(
        await viewer.locator('[data-action="parse-sheet"]').count(),
        0,
      );
      assert.equal(await viewer.locator("#sheet-container").count(), 0);
      await viewer
        .locator('[data-action="view"][data-view="workbench"]')
        .click();
      await viewer.screenshot({
        path: artifactPath("viewer-workbench.png"),
        fullPage: true,
      });
      await viewer.reload();
      await viewer.locator(".task-card").first().waitFor();
      assert.equal(
        await viewer
          .locator('.version-history input[type="checkbox"]')
          .first()
          .isChecked(),
        false,
      );
      await viewer
        .getByRole("button", { name: "账号菜单", exact: true })
        .click();
      await viewer
        .getByRole("button", { name: "修改密码", exact: true })
        .click();
      await viewer
        .locator('[name="currentPassword"]')
        .fill("viewer-browser-password");
      await viewer
        .locator('.password-form [name="password"]')
        .fill("viewer-updated-password");
      await viewer
        .locator('.password-form [name="confirmPassword"]')
        .fill("viewer-updated-password");
      await viewer
        .getByRole("button", { name: "保存新密码", exact: true })
        .click();
      await viewer.locator("#login-form").waitFor();
      const accounts = new Members(f.db);
      await accounts.create({
        username: "browser-editor",
        displayName: "浏览编辑者",
        role: "editor",
        monthlyLimit: 0,
        password: "editor-browser-password",
      });
      const editor = await browser.newPage();
      editor.on("pageerror", (e: Error) => errors.push(e.message));
      await editor.goto(root);
      await editor.locator("#login-username").fill("browser-editor");
      await editor.locator("#login-password").fill("editor-browser-password");
      await editor.click('#login-form button[type="submit"]');
      await editor.locator(".task-card").first().waitFor();
      assert.equal(await editor.locator("#settings-button").count(), 0);
      assert.ok(
        (await editor.locator('[data-action="new-product"]').count()) > 0,
      );
      await editor.locator('[data-action="generate-prompt"]').first().click();
      await editor.waitForFunction(async () => {
        const response = await fetch("/api/jobs/history");
        return response.ok && (await response.json()).jobs.length === 1;
      });
      assert.equal((await f.workflows.repo.view()).jobs[0].kind, "prompt-set");
      assert.equal(
        (await accounts.list()).find(
          (account) => account.username === "browser-editor",
        )?.used,
        0,
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
