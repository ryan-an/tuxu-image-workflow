import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { fixture, password } from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";
import { createLocalCertificate } from "../../scripts/https-certificate.mjs";
import { loadTransportSecurity } from "../../server/production/transport-security.js";
import { Members } from "../../server/production/members.js";

test(
  "default HTTP policy supports a network hostname, session reload, invitations and password changes",
  { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 60000 },
  async () => {
    const { chromium } = createRequire(import.meta.url)(
      process.env.PLAYWRIGHT_MODULE!,
    );
    const f = await fixture(resolve("dist"));
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
      args: [
        "--host-resolver-rules=MAP workspace-http.test 127.0.0.1",
        "--no-proxy-server",
      ],
    });
    try {
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://workspace-http.test:${(f.app.server.address() as AddressInfo).port}`;
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(e.message));
      await page.goto(root);
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      await page.locator(".task-card").first().waitFor();
      const cookie = (await context.cookies()).find(
        (c: { name: string }) => c.name === "tuxu_session",
      );
      assert.equal(cookie.secure, false);
      assert.equal(cookie.httpOnly, true);
      await page.reload();
      await page.locator(".task-card").first().waitFor();
      assert.equal(await page.evaluate(() => window.isSecureContext), false);
      await page.locator(".suite-action-control > button").click();
      const stop = page.getByRole("button", {
        name: "生成整套提示词中，点击终止",
        exact: true,
      });
      await stop.waitFor();
      assert.equal((await f.workflows.repo.view()).jobs.length, 1);
      await stop.click();
      await page
        .getByRole("button", { name: "生成整套提示词", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "添加产品", exact: true })
        .first()
        .click();
      await page.locator('#product-form [name="code"]').fill("HTTP-01");
      await page.locator('#product-form [name="name"]').fill("HTTP 新建产品");
      const saved = page.waitForResponse(
        (response: {
          url(): string;
          status(): number;
          request(): { method(): string };
        }) =>
          response.url().endsWith("/api/workspace") &&
          response.request().method() === "PATCH" &&
          response.status() === 200,
      );
      await page.getByRole("button", { name: "保存产品", exact: true }).click();
      await saved;
      await page.reload();
      await page
        .locator(".product-link")
        .filter({ hasText: "HTTP 新建产品" })
        .waitFor();
      assert.ok(
        (await f.workflows.repo.view()).products.some(
          (product) => product.code === "HTTP-01",
        ),
      );
      const invitation = await new Members(f.db).create({
        username: "http-member",
        displayName: "HTTP 成员",
        role: "editor",
        monthlyLimit: null,
      });
      await page.getByRole("button", { name: "账号菜单", exact: true }).click();
      await page.getByRole("button", { name: "退出登录", exact: true }).click();
      await page.goto(`${root}/invite#token=${invitation.token}`);
      await page.fill("#invite-password", "http-member-password");
      await page.fill("#invite-confirm", "http-member-password");
      await page
        .getByRole("button", { name: "加入工作区", exact: true })
        .click();
      await page.locator("#app").waitFor();
      await page.getByRole("button", { name: "账号菜单", exact: true }).click();
      await page.getByRole("button", { name: "修改密码", exact: true }).click();
      await page
        .locator('.password-form [name="currentPassword"]')
        .fill("http-member-password");
      await page
        .locator('.password-form [name="password"]')
        .fill("http-updated-password");
      await page
        .locator('.password-form [name="confirmPassword"]')
        .fill("http-updated-password");
      await page
        .getByRole("button", { name: "保存新密码", exact: true })
        .click();
      await page.fill("#login-username", "http-member");
      await page.fill("#login-password", "http-updated-password");
      await page.click('#login-form button[type="submit"]');
      await page.locator("#app").waitFor();
      assert.equal(new URL(page.url()).protocol, "http:");
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);

test(
  "HTTPS login, invitation activation and password changes retain secure cookies; network HTTP shows no password form",
  { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 60000 },
  async () => {
    const { chromium } = createRequire(import.meta.url)(
      process.env.PLAYWRIGHT_MODULE!,
    );
    const directory = await mkdtemp(join(tmpdir(), "tuxu-browser-tls-"));
    let f: Awaited<ReturnType<typeof fixture>> | undefined;
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
    });
    try {
      const files = await createLocalCertificate(directory, []);
      const transport = await loadTransportSecurity({
        REQUIRE_HTTPS: "true",
        TLS_CERT_FILE: files.cert,
        TLS_KEY_FILE: files.key,
      });
      f = await fixture(resolve("dist"), transport);
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `https://127.0.0.1:${(f.app.server.address() as AddressInfo).port}`;
      // This isolated context uses an uninstalled test CA; production never disables verification.
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const errors: string[] = [],
        credentialRequests: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(e.message));
      page.on("request", (req: { url(): string; method(): string }) => {
        if (
          req.method() === "POST" &&
          /\/api\/auth\/(login|password|accept-invitation)$/.test(req.url())
        )
          credentialRequests.push(req.url());
      });
      const response = await page.goto(root);
      assert.match(
        (await response.securityDetails()).protocol,
        /^TLS 1\.[23]$/,
      );
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      await page.locator("#app").waitFor();
      const ownerCookie = (await context.cookies()).find(
        (c: { name: string }) => c.name === "tuxu_session",
      );
      assert.equal(ownerCookie.secure, true);
      assert.equal(ownerCookie.httpOnly, true);
      assert.equal(ownerCookie.sameSite, "Strict");
      const invitation = await new Members(f.db).create({
        username: "tls-member",
        displayName: "加密成员",
        role: "editor",
        monthlyLimit: null,
      });
      await page.getByRole("button", { name: "账号菜单", exact: true }).click();
      await page.getByRole("button", { name: "退出登录", exact: true }).click();
      await page.goto(`${root}/invite#token=${invitation.token}`);
      await page.fill("#invite-password", "encrypted-member-password");
      await page.fill("#invite-confirm", "encrypted-member-password");
      await page
        .getByRole("button", { name: "加入工作区", exact: true })
        .click();
      await page.locator("#app").waitFor();
      await page.getByRole("button", { name: "账号菜单", exact: true }).click();
      await page.getByRole("button", { name: "修改密码", exact: true }).click();
      await page
        .locator('.password-form [name="currentPassword"]')
        .fill("encrypted-member-password");
      await page
        .locator('.password-form [name="password"]')
        .fill("updated-member-password");
      await page
        .locator('.password-form [name="confirmPassword"]')
        .fill("updated-member-password");
      await page
        .getByRole("button", { name: "保存新密码", exact: true })
        .click();
      await page.fill("#login-username", "tls-member");
      await page.fill("#login-password", "updated-member-password");
      await page.click('#login-form button[type="submit"]');
      await page.locator("#app").waitFor();
      assert.equal(credentialRequests.length, 4);
      assert.ok(credentialRequests.every((url) => url.startsWith("https://")));

      const insecure = await context.newPage();
      let authRequests = 0;
      insecure.on("request", (req: { url(): string }) => {
        if (
          req.url().includes("/api/auth/") &&
          !req.url().endsWith("/transport-policy")
        )
          authRequests++;
      });
      // Serve the current bundle at an HTTP network origin to exercise the client guard,
      // even though the server normally blocks that navigation before serving HTML.
      await insecure.route(
        "http://insecure.tuxu.test/**",
        async (route: any) => {
          const source = new URL(route.request().url());
          await route.fulfill({
            response: await context.request.get(
              root + source.pathname + source.search,
            ),
          });
        },
      );
      await insecure.goto("http://insecure.tuxu.test/login");
      await insecure
        .getByRole("heading", { name: "请使用加密连接", exact: true })
        .waitFor();
      assert.equal(await insecure.locator('input[type="password"]').count(), 0);
      assert.equal(authRequests, 0);
      await insecure.screenshot({
        path: artifactPath("insecure-connection-blocked.png"),
        fullPage: true,
      });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f?.close();
      if (
        dirname(resolve(directory)) !== resolve(tmpdir()) ||
        !basename(directory).startsWith("tuxu-browser-tls-")
      )
        throw new Error("拒绝清理非测试目录");
      await rm(directory, { recursive: true, force: true });
    }
  },
);
