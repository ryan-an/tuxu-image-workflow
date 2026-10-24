import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fixture, password } from "../support/production.js";
import { Accounts } from "../../server/production/accounts.js";
import { Members } from "../../server/production/members.js";
import { Provisioning } from "../../server/production/provisioning.js";
import { artifactPath } from "../support/artifacts.cjs";

test(
  "different team owners see independent workspaces and stale tabs cannot save into a switched team",
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
      const accounts = new Accounts(f.db);
      const team = await new Provisioning(f.db).provisionTeam({
        username: "browser_team_b",
        password: "team-browser-password",
        workspaceName: "独立 B 团队",
      });
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        acceptDownloads: true,
      });
      const a = await context.newPage(),
        errors: string[] = [];
      a.on("pageerror", (e: Error) => errors.push(e.message));
      await a.goto(root);
      await a.locator("#login-password").fill(password);
      await a.locator('#login-form button[type="submit"]').click();
      await a.locator(".task-card").first().waitFor();
      await a.getByRole("button", { name: "成员管理", exact: true }).click();
      await a.locator(".account-member").waitFor();
      assert.equal(await a.locator(".account-member").count(), 1);
      assert.equal(
        await a.getByText("browser_team_b", { exact: false }).count(),
        0,
      );
      // A second tab changes the cookie without changing the first tab's UI state.
      const loginB = await context.request.post(`${root}/api/auth/login`, {
        data: { username: "browser_team_b", password: "team-browser-password" },
      });
      assert.equal(loginB.status(), 200);
      await a
        .locator('.account-create [name="username"]')
        .fill("stale_should_not_exist");
      await a
        .locator('.account-create [name="displayName"]')
        .fill("过期页面成员");
      await a.getByRole("button", { name: "发送邀请", exact: true }).click();
      await a.locator("#login-form").waitFor();
      const b = await context.newPage();
      b.on("pageerror", (e: Error) => errors.push(e.message));
      await b.goto(root);
      await b.locator("#app").waitFor();
      assert.equal(await b.locator(".task-card").count(), 0);
      assert.equal(await b.locator(".product-item").count(), 0);
      await b.getByRole("button", { name: "成员管理", exact: true }).click();
      await b.locator(".account-member").waitFor();
      assert.equal(await b.locator(".account-member").count(), 1);
      await b
        .locator(".account-member")
        .getByText("@browser_team_b", { exact: true })
        .waitFor();
      await b
        .locator('.account-create [name="username"]')
        .fill("browser_b_member");
      await b.locator('.account-create [name="displayName"]').fill("B团队成员");
      await b.getByRole("button", { name: "发送邀请", exact: true }).click();
      const invitation = b.getByRole("textbox", {
        name: "邀请链接",
        exact: true,
      });
      await invitation.waitFor();
      const invitationUrl = await invitation.inputValue();
      await b.screenshot({
        path: artifactPath("team-b-accounts.png"),
        fullPage: true,
      });
      const member = await browser.newPage();
      await member.goto(invitationUrl);
      await member.getByText(/加入「独立 B 团队」/).waitFor();
      await member.locator("#invite-password").fill("b-team-member-password");
      await member.locator("#invite-confirm").fill("b-team-member-password");
      await member
        .getByRole("button", { name: "加入工作区", exact: true })
        .click();
      await member.locator("#app").waitFor();
      assert.equal(await member.locator(".task-card").count(), 0);
      assert.equal(
        (await new Members(f.db, team.workspaceId).list()).length,
        2,
      );
      assert.equal((await new Members(f.db).list()).length, 1);
      // Logging back into A restores A data and still does not expose B members.
      await a.locator("#login-password").fill(password);
      await a.locator('#login-form button[type="submit"]').click();
      await a.locator(".task-card").first().waitFor();
      await a.getByRole("button", { name: "成员管理", exact: true }).click();
      await a.locator(".account-member").waitFor();
      assert.equal(await a.locator(".account-member").count(), 1);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
