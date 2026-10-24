import test from "node:test";
import assert from "node:assert/strict";
import {
  fixture,
  loginHeaders,
  counts,
  fakeProvider,
  png,
} from "../../support/production.js";
import { Members } from "../../../server/production/members.js";
import { WorkspaceDirectory } from "../../../server/production/workspace-directory.js";
import { Worker } from "../../../server/production/worker.js";
import { recordImageSuccess } from "../../../server/production/account-usage.js";

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function login(f: Fixture, username: string) {
  const result = await f.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password: "person-password-123" },
  });
  assert.equal(result.statusCode, 200, result.body);
  return {
    cookie: String(result.headers["set-cookie"]).split(";")[0],
    "x-account-id": result.json().account.id,
  };
}
async function person(f: Fixture, role: "editor" | "viewer" = "viewer") {
  const member = await new Members(f.db).create({
    username: `person-${role}`,
    displayName: "协作者",
    role,
    monthlyLimit: null,
    password: "person-password-123",
  });
  return { id: member.id, headers: await login(f, `person-${role}`) };
}
const scope = (headers: Record<string, string>, workspaceId: string) => ({
  ...headers,
  "x-workspace-id": workspaceId,
});

test("business write transactions reject revoked roles even when the request captured an earlier editor context", async () => {
  const f = await fixture();
  try {
    const user = await person(f, "editor"),
      actor = (await new WorkspaceDirectory(f.db).context(user.id, "default"))!;
    await new Members(f.db).update(user.id, {
      displayName: "改为只读",
      role: "viewer",
      enabled: true,
      monthlyLimit: null,
    });
    await assert.rejects(
      f.workflows.enqueue(
        "stale-editor-command",
        [{ productId: f.product.id, taskId: f.product.tasks[0].id }],
        "prompt",
        actor,
      ),
      /不能发起任务/,
    );
    assert.equal((await f.workflows.repo.view()).jobs.length, 0);
    await assert.rejects(
      f.workflows.edit(
        [
          {
            path: ["products", f.product.id, "name"],
            before: f.product.name,
            value: "不能保存",
          },
        ],
        actor,
      ),
      /不能发起任务/,
    );
    assert.equal(
      (await f.workflows.repo.view()).products[0].name,
      f.product.name,
    );
  } finally {
    await f.close();
  }
});
async function create(
  f: Fixture,
  headers: Record<string, string>,
  name: string,
) {
  const response = await f.app.inject({
    method: "POST",
    url: "/api/workspaces",
    headers,
    payload: { name },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().id as string;
}
async function invite(
  f: Fixture,
  headers: Record<string, string>,
  role = "editor",
) {
  const response = await f.app.inject({
    method: "POST",
    url: "/api/member-invitations",
    headers,
    payload: { role },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}

test("a viewer can create and own separate workspaces; role, credentials, data and asset access follow each membership", async () => {
  const f = await fixture();
  try {
    const user = await person(f),
      own = await create(f, user.headers, "个人创作"),
      another = await create(f, user.headers, "另一个空间");
    const headers = scope(user.headers, own);
    const list = await f.app.inject({
      url: "/api/workspaces",
      headers: user.headers,
    });
    assert.deepEqual(
      list
        .json()
        .workspaces.map((w: any) => w.role)
        .sort(),
      ["owner", "owner", "viewer"],
    );
    assert.equal(
      (
        await f.app.inject({
          url: `/api/auth/session?workspace=${own}`,
          headers: user.headers,
        })
      ).json().user.role,
      "owner",
    );
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers })).json().products
        .length,
      0,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/workflow/settings", headers })).json()
        .hasKey,
      false,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/workflow/settings",
          headers,
          payload: { apiKey: "private-key" },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await f.app.inject({
          url: "/api/workflow/settings",
          headers: scope(user.headers, another),
        })
      ).json().hasKey,
      false,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/workflow/settings",
          headers: scope(user.headers, "default"),
          payload: { apiKey: "blocked" },
        })
      ).statusCode,
      403,
    );
    const uploaded = await f.app.inject({
      method: "POST",
      url: "/api/assets",
      headers,
      payload: { source: png },
    });
    assert.equal(uploaded.statusCode, 200, uploaded.body);
    const source = uploaded.json().source;
    assert.equal(
      (await f.app.inject({ url: source, headers: user.headers })).statusCode,
      200,
      "images resolve their own space for tabs without custom headers",
    );
    assert.equal(
      (await f.app.inject({ url: source, headers: await loginHeaders(f.app) }))
        .statusCode,
      404,
    );
    assert.equal(
      (
        await f.app.inject({
          url: source,
          headers: scope(user.headers, another),
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await f.app.inject({
          url: "/api/workspace",
          headers: { ...headers, "x-account-id": "someone-else" },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await f.app.inject({
          url: "/api/workspace",
          headers: scope(user.headers, "unknown"),
        })
      ).statusCode,
      403,
    );
  } finally {
    await f.close();
  }
});

test("existing identities join by confirmation without password resets, generic invitations support new identities and one-time redemption", async () => {
  const f = await fixture();
  try {
    const user = await person(f),
      own = await create(f, user.headers, "个人空间"),
      owner = await loginHeaders(f.app);
    const targeted = await f.app.inject({
      method: "POST",
      url: "/api/members",
      headers: scope(user.headers, own),
      payload: {
        username: "admin",
        displayName: "空间内称呼",
        role: "editor",
        monthlyLimit: null,
      },
    });
    assert.equal(targeted.statusCode, 200, targeted.body);
    let token = targeted.json().token;
    const personalMembers = new Members(f.db, own, user.id);
    await personalMembers.update("owner", {
      displayName: "空间内称呼",
      role: "editor",
      enabled: false,
      monthlyLimit: null,
    });
    await personalMembers.update("owner", {
      displayName: "空间内称呼",
      role: "editor",
      enabled: true,
      monthlyLimit: null,
    });
    assert.equal(
      (await personalMembers.list()).find((member) => member.id === "owner")
        ?.status,
      "pending",
      "reenabling does not accept an invitation on someone else’s behalf",
    );
    assert.equal(
      (
        await f.app.inject({
          url: "/api/workspace",
          headers: scope(owner, own),
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/auth/invitation",
          payload: { token },
        })
      ).statusCode,
      410,
    );
    token = (await personalMembers.invite("owner")).token;
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/auth/accept-invitation",
          payload: { token, password: "cannot-reset-password" },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/auth/accept-invitation",
          headers: user.headers,
          payload: { token },
        })
      ).statusCode,
      403,
    );
    const accepted = await f.app.inject({
      method: "POST",
      url: "/api/auth/accept-invitation",
      headers: owner,
      payload: { token, password: "ignored-password" },
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(accepted.json().user.role, "editor");
    assert.equal(
      accepted.headers["set-cookie"],
      undefined,
      "joining keeps the existing global session",
    );
    assert.equal(
      (
        await f.app.inject({
          url: "/api/workspace",
          headers: scope(owner, own),
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers: owner }))
        .statusCode,
      200,
    );
    assert.equal(
      (await new Members(f.db, own).list()).find((m) => m.id === "owner")
        ?.displayName,
      "空间内称呼",
    );
    const shared = await invite(f, owner, "viewer");
    const redeem = () =>
      f.app.inject({
        method: "POST",
        url: "/api/auth/accept-invitation",
        payload: {
          token: shared.token,
          username: "new-person",
          displayName: "新成员",
          password: "person-password-123",
        },
      });
    const results = await Promise.all([redeem(), redeem()]);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 410]);
    assert.equal(
      (
        await f.db.query(
          "SELECT COUNT(*) AS count FROM accounts WHERE username='new-person'",
        )
      ).rows[0].count,
      1,
    );
    const next = await invite(f, scope(user.headers, own), "viewer");
    const existing = await f.app.inject({
      method: "POST",
      url: "/api/auth/accept-invitation",
      headers: await login(f, "new-person"),
      payload: { token: next.token },
    });
    assert.equal(existing.statusCode, 200, existing.body);
    assert.equal(existing.json().user.workspaceId, own);
    const revoked = await invite(f, owner);
    await f.app.inject({
      method: "DELETE",
      url: `/api/member-invitations/${revoked.id}`,
      headers: owner,
    });
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/auth/invitation",
          payload: { token: revoked.token },
        })
      ).statusCode,
      410,
    );
  } finally {
    await f.close();
  }
});

test("removal and disabling affect one membership, users without memberships can still sign in and create a workspace", async () => {
  const f = await fixture();
  try {
    const user = await person(f, "editor"),
      own = await create(f, user.headers, "自己的空间"),
      owner = await loginHeaders(f.app);
    const update = {
      displayName: "只读同事",
      role: "viewer",
      enabled: false,
      monthlyLimit: null,
    };
    assert.equal(
      (
        await f.app.inject({
          method: "PATCH",
          url: `/api/members/${user.id}`,
          headers: owner,
          payload: update,
        })
      ).statusCode,
      200,
    );
    const disabledLink = await invite(f, owner);
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/auth/accept-invitation",
          headers: user.headers,
          payload: { token: disabledLink.token },
        })
      ).statusCode,
      403,
      "a disabled member cannot bypass suspension using a generic invitation",
    );
    assert.equal(
      (
        await f.app.inject({
          url: "/api/workspace",
          headers: scope(user.headers, "default"),
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          url: "/api/workspace",
          headers: scope(user.headers, own),
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "DELETE",
          url: `/api/members/${user.id}`,
          headers: owner,
        })
      ).statusCode,
      200,
    );
    const session = await f.app.inject({
      url: "/api/auth/session",
      headers: user.headers,
    });
    assert.equal(session.json().account.id, user.id);
    const isolated = await new Members(f.db).create({
      username: "only-invited",
      displayName: "临时协作者",
      role: "viewer",
      monthlyLimit: null,
      password: "person-password-123",
    });
    await new Members(f.db).remove(isolated.id);
    const headers = await login(f, "only-invited");
    assert.equal(
      (await f.app.inject({ url: "/api/auth/session", headers })).json().user,
      null,
    );
    assert.ok(await create(f, headers, "重新开始"));
    await f.reopen();
    assert.equal(
      (
        await f.app.inject({
          url: "/api/workspace",
          headers: scope(user.headers, own),
        })
      ).statusCode,
      200,
    );
  } finally {
    await f.close();
  }
});

test("ownership transfer, leave, archive and restore enforce lifecycle rules without changing global account privileges", async () => {
  const f = await fixture();
  try {
    const user = await person(f),
      owner = await loginHeaders(f.app),
      directory = new WorkspaceDirectory(f.db);
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/workspaces/default/leave",
          headers: owner,
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/workspaces/default/transfer",
          headers: owner,
          payload: { accountId: "missing" },
        })
      ).statusCode,
      400,
    );
    const transfer = await f.app.inject({
      method: "POST",
      url: "/api/workspaces/default/transfer",
      headers: owner,
      payload: { accountId: user.id },
    });
    assert.equal(transfer.statusCode, 200, transfer.body);
    assert.equal(
      (
        await f.db.query(
          "SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id='default' AND role='owner'",
        )
      ).rows[0].count,
      1,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/members", headers: owner })).statusCode,
      403,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/members", headers: user.headers }))
        .statusCode,
      200,
    );
    await f.reopen();
    assert.equal(
      (await new WorkspaceDirectory(f.db).context("owner", "default"))?.role,
      "editor",
      "bootstrap does not take ownership back",
    );
    const activeProduct = (await f.workflows.repo.view()).products[0];
    const queued = await f.app.inject({
      method: "POST",
      url: "/api/jobs",
      headers: user.headers,
      payload: {
        commandId: "archive-pending",
        kind: "prompt",
        pairs: [
          { productId: activeProduct.id, taskId: activeProduct.tasks[0].id },
        ],
      },
    });
    assert.equal(queued.statusCode, 200, queued.body);
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/workspaces/default/archive",
          headers: user.headers,
          payload: { archived: true },
        })
      ).statusCode,
      409,
    );
    const activeJob = (await f.workflows.repo.view()).jobs[0];
    await f.workflows.control(activeJob.id, "cancel", {
      commandId: "cancel-before-archive",
    });
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/workspaces/default/archive",
          headers: owner,
          payload: { archived: true },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/workspaces/default/archive",
          headers: user.headers,
          payload: { archived: true },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers: user.headers }))
        .statusCode,
      403,
    );
    assert.equal(
      await new Worker(f.workflows, fakeProvider(counts()), () => {}).step(),
      false,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/workspaces/default/archive",
          headers: user.headers,
          payload: { archived: false },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers: owner }))
        .statusCode,
      200,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/workspaces/default/leave",
          headers: owner,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers: owner }))
        .statusCode,
      403,
    );
  } finally {
    await f.close();
  }
});

test("successful-image usage is per workspace and member, survives leaving, and cannot be booked into a foreign membership", async () => {
  const f = await fixture();
  try {
    const user = await person(f, "editor"),
      own = await create(f, user.headers, "个人图片"),
      owner = await loginHeaders(f.app);
    const product = (await f.workflows.repo.view()).products[0];
    product.tasks[0].prompt = "图片提示词";
    await f.workflows.repo.saveProduct(f.db, product);
    const enqueue = await f.app.inject({
      method: "POST",
      url: "/api/jobs",
      headers: scope(user.headers, "default"),
      payload: {
        commandId: "count-success",
        kind: "image",
        pairs: [{ productId: product.id, taskId: product.tasks[0].id }],
      },
    });
    assert.equal(enqueue.statusCode, 200, enqueue.body);
    const worker = new Worker(f.workflows, fakeProvider(counts()), () => {});
    await worker.step();
    await f.due();
    await worker.step();
    const completed = (await f.workflows.repo.view()).jobs[0];
    await f.db.transaction((tx) =>
      recordImageSuccess(
        tx,
        { ...completed, id: "other-workspace-result" },
        own,
      ),
    );
    await f.db.transaction((tx) =>
      recordImageSuccess(tx, completed, "default"),
    );
    assert.equal(
      (await new Members(f.db).list()).find((m) => m.id === user.id)?.used,
      1,
    );
    assert.equal(
      (await new Members(f.db, own).list()).find((m) => m.id === user.id)?.used,
      1,
    );
    await new Members(f.db).remove(user.id);
    assert.equal(
      (
        await f.db.query(
          "SELECT used FROM account_usage WHERE workspace_id=$1 AND account_id=$2",
          ["default", user.id],
        )
      ).rows[0].used,
      1,
    );
    const link = await invite(f, owner);
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/auth/accept-invitation",
          headers: user.headers,
          payload: { token: link.token },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await new Members(f.db).list()).find((m) => m.id === user.id)?.used,
      1,
    );
  } finally {
    await f.close();
  }
});
