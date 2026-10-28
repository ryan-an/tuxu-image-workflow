import test from "node:test";
import assert from "node:assert/strict";
import { fixture, loginHeaders } from "../../support/production.js";
import {
  Admin,
  adminFailureAction,
  recordAdminAudit,
} from "../../../server/production/admin.js";
import { Members } from "../../../server/production/members.js";
import { usagePeriod } from "../../../server/production/account-usage.js";

const password = "admin-created-password-123";
test("failed management requests use canonical actions and never arbitrary URLs", () => {
  assert.equal(
    adminFailureAction("POST", "/api/admin/accounts/:id/disable"),
    "account.disable",
  );
  assert.equal(
    adminFailureAction("POST", "/api/admin/accounts/owner/disable"),
    "account.disable",
  );
  assert.equal(
    adminFailureAction("POST", "/api/members/existing"),
    "member.add",
  );
  assert.equal(
    adminFailureAction("POST", "/api/members/:id/invitation"),
    "invitation.create",
  );
  assert.equal(
    adminFailureAction("DELETE", "/api/member-invitations/:id"),
    "invitation.revoke",
  );
  assert.equal(
    adminFailureAction("POST", "/api/workflow/credentials"),
    "workspace.credentials.update",
  );
  assert.equal(
    adminFailureAction("POST", "/api/workflow/settings"),
    "workspace.settings.update",
  );
  assert.equal(
    adminFailureAction(
      "POST",
      "/api/unknown/credential-like-value?secret=value",
    ),
    "request.failure",
  );
});
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function account(
  f: Fixture,
  headers: Record<string, string>,
  username: string,
) {
  const result = await f.app.inject({
    method: "POST",
    url: "/api/admin/accounts",
    headers,
    payload: { username, displayName: username, password },
  });
  assert.equal(result.statusCode, 200, result.body);
  return result.json().id as string;
}
async function login(f: Fixture, username: string, secret = password) {
  const response = await f.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password: secret },
  });
  assert.equal(response.statusCode, 200, response.body);
  return { cookie: String(response.headers["set-cookie"]).split(";")[0] };
}

test("admin accounts are paginated global identities; ordinary accounts cannot forge system access", async () => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app),
      id = await account(f, headers, "alpha-admin-test");
    const memberships = (
      await f.db.query("SELECT * FROM workspace_members WHERE account_id=$1", [
        id,
      ])
    ).rows;
    assert.equal(
      memberships.length,
      0,
      "global account creation must not create an implicit workspace",
    );
    const read = await f.app.inject({
      url: "/api/admin/accounts?q=alpha&pageSize=1",
      headers,
    });
    assert.equal(read.statusCode, 200, read.body);
    assert.equal(read.json().total, 1);
    assert.equal(read.json().items[0].workspaceCount, 0);
    assert.ok(!read.body.includes("password_hash"));
    assert.ok(!read.body.includes(password));
    const ordinary = await login(f, "alpha-admin-test");
    for (const url of [
      "/api/admin/accounts",
      "/api/admin/workspaces",
      "/api/admin/audit-logs",
    ]) {
      const denied = await f.app.inject({
        url,
        headers: {
          ...ordinary,
          "x-admin-mode": "1",
          "x-system-role": "super_admin",
        },
      });
      assert.equal(denied.statusCode, 403, denied.body);
    }
    assert.equal(
      (await f.app.inject({ url: "/api/admin/accounts?pageSize=101", headers }))
        .statusCode,
      400,
    );
    const detail = await f.app.inject({
      url: `/api/admin/accounts/${id}`,
      headers,
    });
    assert.equal(detail.json().account.id, id);
    assert.deepEqual(detail.json().workspaces, []);
    assert.equal(
      (
        await f.app.inject({
          method: "PATCH",
          url: `/api/admin/accounts/${id}`,
          headers,
          payload: { displayName: "禁止静默接受", systemRole: "super_admin" },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await f.app.inject({
          url: "/api/admin/accounts?systemRole=super_admin",
          headers,
        })
      ).statusCode,
      400,
    );
  } finally {
    await f.close();
  }
});

test("global disable, enable, password reset and session revocation preserve independent memberships", async () => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app),
      id = await account(f, headers, "lifecycle-user");
    const member = await new Members(f.db).create({
      username: "lifecycle-user",
      displayName: "空间称呼",
      role: "editor",
      monthlyLimit: null,
    });
    await f.db.query(
      "UPDATE workspace_members SET status='active',accepted_at=$3 WHERE workspace_id=$1 AND account_id=$2",
      ["default", id, Date.now()],
    );
    const renamed = await f.app.inject({
      method: "PATCH",
      url: `/api/admin/accounts/${id}`,
      headers,
      payload: { displayName: "新的个人名称" },
    });
    assert.equal(renamed.statusCode, 200, renamed.body);
    assert.equal(
      (
        await f.db.query(
          "SELECT display_name FROM workspace_members WHERE workspace_id='default' AND account_id=$1",
          [id],
        )
      ).rows[0].display_name,
      "空间称呼",
    );
    let ordinary = await login(f, "lifecycle-user");
    const post = (action: string, payload: object = {}) =>
      f.app.inject({
        method: "POST",
        url: `/api/admin/accounts/${id}/${action}`,
        headers,
        payload,
      });
    assert.equal((await post("disable")).statusCode, 200);
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers: ordinary }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT status,display_name FROM workspace_members WHERE workspace_id='default' AND account_id=$1",
          [id],
        )
      ).rows[0].status,
      "active",
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT id FROM workspace_invitations WHERE account_id=$1",
          [id],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (await post("reset-password", { password: "replacement-password-123" }))
        .statusCode,
      409,
    );
    assert.equal((await post("enable")).statusCode, 200);
    ordinary = await login(f, "lifecycle-user");
    assert.equal((await post("revoke-sessions")).statusCode, 200);
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers: ordinary }))
        .statusCode,
      401,
    );
    ordinary = await login(f, "lifecycle-user");
    assert.equal(
      (await post("reset-password", { password: "replacement-password-123" }))
        .statusCode,
      200,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers: ordinary }))
        .statusCode,
      401,
    );
    await login(f, "lifecycle-user", "replacement-password-123");
    const pending = await new Members(f.db).create({
      username: "pending-admin-test",
      displayName: "未激活",
      role: "viewer",
      monthlyLimit: null,
    });
    for (const action of ["enable", "disable", "reset-password"]) {
      const response = await f.app.inject({
        method: "POST",
        url: `/api/admin/accounts/${pending.id}/${action}`,
        headers,
        payload: action === "reset-password" ? { password } : {},
      });
      assert.equal(response.statusCode, 409, response.body);
    }
    for (const action of ["enable", "disable", "reset-password"]) {
      const response = await f.app.inject({
        method: "POST",
        url: `/api/admin/accounts/owner/${action}`,
        headers,
        payload: action === "reset-password" ? { password } : {},
      });
      assert.equal(response.statusCode, 403, response.body);
    }
    const failures = await f.app.inject({
      url: "/api/admin/audit-logs?action=account.disable",
      headers,
    });
    assert.equal(failures.statusCode, 200, failures.body);
    assert.ok(
      failures
        .json()
        .items.some(
          (entry: any) =>
            entry.result === "failure" &&
            entry.targetAccountId === "owner" &&
            entry.errorCode === "HTTP_403",
        ),
      "filtering account.disable must include its failed requests",
    );
    assert.ok(member.token);
  } finally {
    await f.close();
  }
});

test("admin workspace lifecycle uses explicit owner and atomic transfer without adding administrator membership", async () => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app),
      ownerId = await account(f, headers, "workspace-owner-test"),
      targetId = await account(f, headers, "workspace-target-test");
    const created = await f.app.inject({
      method: "POST",
      url: "/api/admin/workspaces",
      headers,
      payload: { name: "超级管理的空间", ownerId },
    });
    assert.equal(created.statusCode, 200, created.body);
    const id = created.json().id;
    const context = { ...headers, "x-workspace-id": id, "x-admin-mode": "1" };
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers: context }))
        .statusCode,
      200,
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT * FROM workspace_members WHERE workspace_id=$1 AND account_id='owner'",
          [id],
        )
      ).rows.length,
      0,
    );
    const transfer = () =>
      f.app.inject({
        method: "POST",
        url: `/api/admin/workspaces/${id}/transfer-owner`,
        headers,
        payload: { accountId: targetId },
      });
    assert.equal((await transfer()).statusCode, 400);
    const add = await f.app.inject({
      method: "POST",
      url: "/api/members/existing",
      headers: context,
      payload: { accountId: targetId, displayName: "受让成员", role: "editor" },
    });
    assert.equal(add.statusCode, 200, add.body);
    assert.equal((await transfer()).statusCode, 200);
    const owners = (
      await f.db.query(
        "SELECT account_id FROM workspace_members WHERE workspace_id=$1 AND role='owner'",
        [id],
      )
    ).rows;
    assert.deepEqual(owners, [{ account_id: targetId }]);
    const archive = await f.app.inject({
      method: "POST",
      url: `/api/admin/workspaces/${id}/archive`,
      headers,
      payload: {},
    });
    assert.equal(archive.statusCode, 200, archive.body);
    for (const url of ["/api/members", "/api/member-invitations"])
      assert.equal(
        (await f.app.inject({ url, headers: context })).statusCode,
        200,
      );
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers: context }))
        .statusCode,
      200,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/members/existing",
          headers: context,
          payload: {
            accountId: "owner",
            displayName: "管理员",
            role: "editor",
          },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `/api/admin/workspaces/${id}/restore`,
          headers,
          payload: {},
        })
      ).statusCode,
      200,
    );
    const access = await f.app.inject({
      method: "POST",
      url: `/api/admin/workspaces/${id}/access`,
      headers,
      payload: {},
    });
    assert.match(access.json().url, /admin=1/);
    const read = await f.app.inject({
      url: "/api/admin/workspaces?q=workspace-target",
      headers,
    });
    assert.equal(read.json().total, 1);
    const logs = await f.app.inject({
      url: `/api/admin/audit-logs?q=${id}&action=workspace.transfer-owner`,
      headers,
    });
    assert.equal(
      logs.json().total,
      2,
      "operation filters include success and failure results",
    );
    const transferred = logs
      .json()
      .items.find((item: { result: string }) => item.result === "success");
    assert.equal(transferred.changes.after.ownerId, targetId);
    assert.ok(
      logs
        .json()
        .items.some(
          (item: { result: string; errorCode: string }) =>
            item.result === "failure" && item.errorCode === "HTTP_400",
        ),
    );
  } finally {
    await f.close();
  }
});

test("admin usage is included in workspace totals and audit values are white-listed and transactional", async () => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app),
      period = usagePeriod();
    await f.db.query(
      "INSERT INTO admin_usage(workspace_id,account_id,period,used) VALUES('default','owner',$1,3)",
      [period],
    );
    await f.db.query(
      "INSERT INTO account_usage(workspace_id,account_id,period,used) VALUES('default','owner',$1,2)",
      [period],
    );
    const detail = await f.app.inject({
      url: `/api/admin/workspaces/default?period=${period}`,
      headers,
    });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.equal(detail.json().usage.total, 5);
    assert.equal(detail.json().usage.administrator, 3);
    await f.db.transaction((tx) =>
      recordAdminAudit(tx, {
        actorId: "owner",
        action: "test.sanitize",
        requestId: "sanitize",
        before: {
          password: "secret-password",
          apiKey: "secret-key",
          cookie: "secret-cookie",
          token: "secret-token",
          name: "旧名",
          baseUrl:
            "https://grsaiapi.com/path?api_key=secret-query#secret-fragment",
        },
        after: { displayName: "新名", hasKey: true },
      }),
    );
    const logs = await f.app.inject({
      url: "/api/admin/audit-logs?action=test.sanitize",
      headers,
    });
    assert.equal(logs.statusCode, 200, logs.body);
    assert.ok(!logs.body.includes("secret-"));
    assert.deepEqual(logs.json().items[0].changes.before, {
      name: "旧名",
      baseUrl: "https://grsaiapi.com",
    });
    assert.equal(
      (
        await f.app.inject({
          url: "/api/admin/audit-logs?from=2026-02-31",
          headers,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await f.app.inject({
          url: "/api/admin/audit-logs?from=2026-10-29&to=2026-10-28",
          headers,
        })
      ).statusCode,
      400,
    );
    const admin = new Admin(f.db, "owner", "rollback-test");
    await f.db.query(
      "CREATE TRIGGER reject_admin_audit BEFORE INSERT ON admin_audit_logs WHEN NEW.request_id='rollback-test' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;",
    );
    await assert.rejects(
      admin.renameAccount("owner", "不可提交的名称"),
      /audit unavailable/,
    );
    assert.notEqual(
      (await admin.accountDetail("owner")).account.displayName,
      "不可提交的名称",
    );
  } finally {
    await f.close();
  }
});
