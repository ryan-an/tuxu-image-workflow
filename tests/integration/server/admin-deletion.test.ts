import test from "node:test";
import assert from "node:assert/strict";
import { fixture, loginHeaders } from "../../support/production.js";
import { Admin } from "../../../server/production/admin.js";
import { Members } from "../../../server/production/members.js";
import { WorkspaceDirectory } from "../../../server/production/workspace-directory.js";
import {
  recordImageSuccess,
  usagePeriod,
} from "../../../server/production/account-usage.js";
import type { Job } from "../../../server/production/types.js";

test("deleting an account revokes access and invitations while retaining history and reserved identity", async () => {
  const f = await fixture();
  try {
    const admin = new Admin(f.db, "owner", "delete-setup");
    const username = "delete-account-user",
      password = "delete-account-password-123";
    const { id } = await admin.createAccount({
      username,
      password,
      displayName: "待删除用户",
    });
    const directory = new WorkspaceDirectory(f.db);
    const actor = (await directory.context("owner", "default", true))!;
    await new Members(f.db, "default", actor).addExisting({
      accountId: id,
      displayName: "成员称呼",
      role: "editor",
    });
    const other = await admin.createWorkspace({
      name: "另一个邀请空间",
      ownerId: "owner",
    });
    const otherActor = (await directory.context("owner", other.id, true))!;
    const invite = await new Members(f.db, other.id, otherActor).create({
      username,
      displayName: "邀请称呼",
      role: "viewer",
      monthlyLimit: null,
    });
    const login = await f.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username, password },
    });
    assert.equal(login.statusCode, 200);
    const userHeaders = {
      cookie: String(login.headers["set-cookie"]).split(";")[0],
    };
    const headers = await loginHeaders(f.app);
    const completed = {
      id: "retained-before-delete",
      kind: "image",
      status: "completed",
      finishedAt: Date.now(),
      createdBy: { id, username, displayName: "成员称呼" },
    } as Job;
    await f.db.transaction((tx) =>
      recordImageSuccess(tx, completed, "default"),
    );
    assert.equal(
      (
        await f.app.inject({
          method: "DELETE",
          url: `/api/admin/accounts/${id}`,
          headers: userHeaders,
          payload: { username },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "DELETE",
          url: `/api/admin/accounts/${id}`,
          headers,
          payload: { username: "wrong-name" },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers: userHeaders }))
        .statusCode,
      200,
    );
    const response = await f.app.inject({
      method: "DELETE",
      url: `/api/admin/accounts/${id}`,
      headers,
      payload: { username },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(
      (
        await f.db.query(
          "SELECT status,password_hash FROM accounts WHERE id=$1",
          [id],
        )
      ).rows[0],
      { status: "deleted", password_hash: null },
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT COUNT(*) AS count FROM account_sessions WHERE account_id=$1",
          [id],
        )
      ).rows[0].count,
      0,
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT COUNT(*) AS count FROM workspace_invitations WHERE account_id=$1",
          [id],
        )
      ).rows[0].count,
      0,
    );
    assert.ok(
      (
        await f.db.query(
          "SELECT status FROM workspace_members WHERE account_id=$1",
          [id],
        )
      ).rows.every((row) => row.status === "deleted"),
    );
    assert.equal(
      (await new Members(f.db).list()).some((row) => row.id === id),
      false,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers: userHeaders }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { username, password },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/auth/accept-invitation",
          payload: { token: invite.token },
        })
      ).statusCode,
      410,
    );
    assert.equal(
      (
        await f.app.inject({
          url: `/api/admin/accounts?q=${username}`,
          headers,
        })
      ).json().total,
      0,
    );
    assert.equal(
      (await f.app.inject({ url: `/api/admin/accounts/${id}`, headers }))
        .statusCode,
      404,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `/api/admin/accounts/${id}/enable`,
          headers,
          payload: {},
        })
      ).statusCode,
      404,
    );
    await assert.rejects(
      admin.createAccount({ username, password, displayName: "重复身份" }),
      /用户名已存在/,
    );
    await f.db.transaction((tx) =>
      recordImageSuccess(
        tx,
        { ...completed, id: "finished-after-delete" },
        "default",
      ),
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT used FROM account_usage WHERE account_id=$1 AND period=$2",
          [id, usagePeriod()],
        )
      ).rows[0].used,
      2,
    );
    const audit = await admin.auditLogs({ q: id, action: "account.delete" });
    assert.equal(
      audit.items.filter((item) => item.result === "success").length,
      1,
    );
    assert.equal(
      audit.items.find((item) => item.result === "success")?.changes.after
        ?.status,
      "deleted",
    );
    assert.equal((await f.workflows.repo.view()).products.length, 1);
  } finally {
    await f.close();
  }
});

test("deletion protects administrators and owners, supports pending accounts, and rolls back with its audit", async () => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app);
    const admin = new Admin(f.db, "owner", "delete-protection");
    assert.equal(
      (
        await f.app.inject({
          method: "DELETE",
          url: "/api/admin/accounts/owner",
          headers,
          payload: { username: "admin" },
        })
      ).statusCode,
      403,
    );
    const { id } = await admin.createAccount({
      username: "delete-space-owner",
      displayName: "空间所有者",
      password: "delete-owner-password-123",
    });
    const space = await admin.createWorkspace({
      name: "删除前必须转让",
      ownerId: id,
    });
    await admin.archiveWorkspace(space.id, true);
    const rejected = await f.app.inject({
      method: "DELETE",
      url: `/api/admin/accounts/${id}`,
      headers,
      payload: { username: "delete-space-owner" },
    });
    assert.equal(rejected.statusCode, 409);
    assert.equal(
      (
        await f.db.query(
          "SELECT account_id FROM workspace_members WHERE workspace_id=$1 AND role='owner'",
          [space.id],
        )
      ).rows[0].account_id,
      id,
    );
    const pending = await new Members(f.db).create({
      username: "delete-pending-user",
      displayName: "待激活用户",
      role: "viewer",
      monthlyLimit: null,
    });
    await f.db.query(
      "CREATE TRIGGER reject_account_deletion BEFORE INSERT ON admin_audit_logs WHEN NEW.action='account.delete' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;",
    );
    const remove = () =>
      f.app.inject({
        method: "DELETE",
        url: `/api/admin/accounts/${pending.id}`,
        headers,
        payload: { username: "delete-pending-user" },
      });
    assert.equal((await remove()).statusCode, 500);
    assert.equal(
      (
        await f.db.query("SELECT status FROM accounts WHERE id=$1", [
          pending.id,
        ])
      ).rows[0].status,
      "pending",
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT COUNT(*) AS count FROM workspace_invitations WHERE account_id=$1",
          [pending.id],
        )
      ).rows[0].count,
      1,
    );
    await f.db.query("DROP TRIGGER reject_account_deletion");
    assert.equal((await remove()).statusCode, 200);
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/auth/accept-invitation",
          payload: {
            token: pending.token,
            password: "activation-password-123",
          },
        })
      ).statusCode,
      410,
    );
    assert.deepEqual((await f.db.query("PRAGMA foreign_key_check")).rows, []);
  } finally {
    await f.close();
  }
});
