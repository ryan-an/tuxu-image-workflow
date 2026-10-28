import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fixture, password } from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";
import { Members } from "../../server/production/members.js";

test(
  "model preferences follow the current account and workspace across tabs, reloads and collaborative edits",
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
      await new Members(f.db).create({
        username: "personal-editor",
        displayName: "个人配置编辑者",
        role: "editor",
        password,
        monthlyLimit: null,
      });
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const ownerContext = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      const memberContext = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      const owner = await ownerContext.newPage();
      const member = await memberContext.newPage();
      const login = async (page: any, username: string) => {
        await page.goto(`${root}/?workspace=default`);
        await page.fill("#login-username", username);
        await page.fill("#login-password", password);
        await page.click('#login-form button[type="submit"]');
        await page.locator(".topbar").waitFor();
      };
      const saveSize = async (page: any, size: string) => {
        await page.locator("#settings-button").click();
        assert.equal(
          await page.locator("#settings-form .api-key-field").count(),
          0,
        );
        await page.selectOption('#settings-form [name="imageSize"]', size);
        await page.locator('#settings-form button[type="submit"]').click();
        await page.locator("#settings-form").waitFor({ state: "detached" });
      };
      const checkSize = async (page: any, size: string) => {
        await page.locator("#settings-button").click();
        assert.equal(
          await page.locator('#settings-form [name="imageSize"]').inputValue(),
          size,
        );
        await page.keyboard.press("Escape");
      };
      await login(owner, "admin");
      await login(member, "personal-editor");
      await saveSize(member, "2K");
      await saveSize(owner, "1K");
      await owner.locator("#settings-button").click();
      await owner.selectOption(
        '#settings-form [name="promptModel"]',
        "__custom",
      );
      await owner.fill(
        '#settings-form [name="customPromptModel"]',
        "ep-shared-browser",
      );
      await owner.selectOption(
        '#settings-form [name="baseUrl"]',
        "https://grsaiapi.com",
      );
      await owner.locator('#settings-form button[type="submit"]').click();
      await owner.locator("#settings-form").waitFor({ state: "detached" });
      const memberConfig = await member.request.get(
        `${root}/api/workflow/settings`,
        { headers: { "X-Workspace-Id": "default" } },
      );
      assert.equal(
        (await memberConfig.json()).promptModel,
        "ep-shared-browser",
      );
      await checkSize(member, "2K");
      const created = await member.request.post(`${root}/api/workspaces`, {
        data: { name: "配置独立的工作区" },
      });
      assert.equal(created.status(), 200);
      const workspaceId = (await created.json()).id;
      const other = await member.context().newPage();
      await other.goto(`${root}/?workspace=${workspaceId}`);
      await other.locator(".topbar").waitFor();
      await saveSize(other, "4K");
      await member.reload();
      await checkSize(member, "2K");
      await checkSize(other, "4K");
      await checkSize(owner, "1K");
      const update = await owner.request.patch(`${root}/api/workspace`, {
        headers: { "X-Workspace-Id": "default" },
        data: {
          edits: [
            {
              path: ["products", f.product.id, "name"],
              before: f.product.name,
              value: "协作刷新后的产品",
            },
          ],
        },
      });
      assert.equal(update.status(), 200);
      await member
        .getByRole("heading", { name: "协作刷新后的产品", exact: true })
        .waitFor();
      await checkSize(member, "2K");
      await member.screenshot({
        path: artifactPath("personal-model-settings-workspace.png"),
      });
      await owner.locator("#api-keys-button").click();
      await owner.locator("#credentials-form").waitFor();
      assert.equal(await owner.locator("#credentials-form select").count(), 0);
      assert.equal(
        await owner.locator("#credentials-form .api-key-field").count(),
        2,
      );
      await owner.screenshot({
        path: artifactPath("workspace-api-keys-dialog.png"),
      });
    } finally {
      await browser.close();
      await f.close();
    }
  },
);

test(
  "editors can save settings without API key controls while viewers have no settings entry",
  { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 45000 },
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
      for (const role of ["editor", "viewer"] as const)
        await new Members(f.db).create({
          username: `settings-${role}`,
          displayName: role,
          password,
          role,
          monthlyLimit: null,
        });
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const keys = [await f.workflows.key(), await f.workflows.key("doubao")];
      for (const role of ["editor", "viewer"] as const) {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(root);
        await page.fill("#login-username", `settings-${role}`);
        await page.fill("#login-password", password);
        await page.click('#login-form button[type="submit"]');
        await page.locator(".task-card").first().waitFor();
        const button = page.locator("#settings-button");
        if (role === "viewer") {
          assert.equal(await button.count(), 0);
        } else {
          assert.equal(await button.getAttribute("aria-label"), "模型配置");
          assert.equal(await page.locator("#api-keys-button").count(), 0);
          assert.equal(await button.locator(".settings-key-status").count(), 0);
          await button.click();
          const form = page.locator("#settings-form");
          await form.waitFor();
          assert.equal(
            await form
              .locator(
                '[name="promptProvider"], [name="promptModel"], [name="customPromptModel"], [name="mode"], [name="baseUrl"]',
              )
              .count(),
            0,
          );
          assert.equal(
            await form
              .locator('input[type="password"], .api-key-field, .api-key-clear')
              .count(),
            0,
          );
          assert.equal((await form.textContent()).includes("API Key"), false);
          await form.locator('[name="imageSize"]').selectOption("2K");
          const request = page.waitForRequest(
            (request: any) =>
              request.method() === "POST" &&
              request.url().endsWith("/api/workflow/settings"),
          );
          await form.locator('button[type="submit"]').click();
          const payload = (await request).postDataJSON();
          for (const name of [
            "apiKey",
            "promptApiKey",
            "clearKey",
            "clearPromptKey",
            "promptProvider",
            "promptModel",
            "mode",
            "baseUrl",
          ])
            assert.equal(Object.hasOwn(payload, name), false);
          await form.waitFor({ state: "detached" });
          await page.reload();
          await button.click();
          assert.equal(
            await page.locator('[name="imageSize"]').inputValue(),
            "2K",
          );
          assert.deepEqual(
            [await f.workflows.key(), await f.workflows.key("doubao")],
            keys,
          );
          await page.screenshot({ path: artifactPath("settings-editor.png") });
        }
        await context.close();
      }
    } finally {
      await browser.close();
      await f.close();
    }
  },
);

test(
  "settings button reports saved API keys after save, clear and reload at desktop and mobile widths",
  { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 45000 },
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
      await f.workflows.updateSettings({
        clearKey: true,
        clearPromptKey: true,
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
      const button = page.locator("#api-keys-button");
      const status = button.locator(".settings-key-status");
      const checkStatus = async (text: string, configured = false) => {
        await page.waitForFunction(
          (text: string) =>
            document
              .querySelector(".settings-key-status")
              ?.getAttribute("aria-label") === text,
          text,
        );
        assert.equal(
          await status.textContent(),
          configured ? "已配置" : "待配置",
        );
        assert.equal(
          await status.getAttribute("data-badge-tone"),
          configured ? "success" : "danger",
        );
        for (const width of [1440, 1024, 780, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          assert.equal(await status.isVisible(), true, `status at ${width}px`);
          const dot = await status
            .locator(".settings-key-dot")
            .evaluate((element: Element) => {
              const style = getComputedStyle(element);
              const bounds = element.getBoundingClientRect();
              return {
                background: style.backgroundColor,
                color: style.color,
                radius: style.borderRadius,
                width: bounds.width,
                height: bounds.height,
              };
            });
          assert.equal(dot.background, dot.color);
          assert.equal(
            dot.color,
            configured ? "rgb(20, 122, 66)" : "rgb(201, 47, 70)",
          );
          assert.equal(dot.radius, "50%");
          assert.ok(dot.width > 0);
          assert.equal(dot.width, dot.height);
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            true,
            `page must not overflow at ${width}px`,
          );
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
      };
      const save = async () => {
        await page.locator('#credentials-form button[type="submit"]').click();
        await page.locator("#credentials-form").waitFor({ state: "detached" });
      };

      await checkStatus("未设置豆包、Grsai API Key");
      await button.click();
      await page.fill('[name="promptApiKey"]', "unsaved-doubao-key");
      await page.keyboard.press("Escape");
      await checkStatus("未设置豆包、Grsai API Key");

      await button.click();
      await page.fill('[name="promptApiKey"]', "saved-doubao-key");
      await save();
      await checkStatus("未设置Grsai API Key");
      await page.reload();
      await checkStatus("未设置Grsai API Key");

      await button.click();
      await page.fill('[name="apiKey"]', "saved-grsai-key");
      await save();
      await checkStatus("已填 API Key", true);
      await page
        .locator("#save-status")
        .getByText("已保存数据", { exact: true })
        .waitFor();
      assert.equal(
        await page.locator("#save-status .save-status-dot").isVisible(),
        true,
      );
      assert.equal(
        await page
          .locator(".save-status-dot")
          .evaluate(
            (element: Element) => getComputedStyle(element).backgroundColor,
          ),
        "rgb(20, 122, 66)",
      );
      await page.screenshot({
        path: artifactPath("settings-keys-configured.png"),
      });

      await button.click();
      await page
        .getByRole("button", { name: "清除豆包密钥", exact: true })
        .click();
      await page
        .getByRole("button", { name: "清除豆包密钥", exact: true })
        .waitFor({ state: "detached" });
      await page.keyboard.press("Escape");
      await checkStatus("未设置豆包 API Key");
      await page.screenshot({
        path: artifactPath("settings-doubao-key-missing.png"),
      });

      await button.click();
      await page
        .getByRole("button", { name: "清除生图密钥", exact: true })
        .click();
      await page
        .getByRole("button", { name: "清除生图密钥", exact: true })
        .waitFor({ state: "detached" });
      await page.keyboard.press("Escape");
      await checkStatus("未设置豆包、Grsai API Key");
      await page.reload();
      await checkStatus("未设置豆包、Grsai API Key");
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
