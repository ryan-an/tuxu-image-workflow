import test from "node:test";
import assert from "node:assert/strict";
import {
  fixture,
  loginHeaders,
  png,
  counts,
  fakeProvider,
} from "../../support/production.js";
import { Accounts } from "../../../server/production/accounts.js";
import { Members } from "../../../server/production/members.js";
import { Provisioning } from "../../../server/production/provisioning.js";
import { recordImageSuccess } from "../../../server/production/account-usage.js";
import { Worker } from "../../../server/production/worker.js";
import { ProviderError } from "../../../server/production/provider.js";
import { actionAllowed } from "../../../shared/access.js";

const memberPassword = "member-password-123";
async function member(
  f: Awaited<ReturnType<typeof fixture>>,
  role: "editor" | "viewer",
  monthlyLimit: number | null = null,
) {
  const owner = await loginHeaders(f.app);
  const created = await f.app.inject({
    method: "POST",
    url: "/api/members",
    headers: owner,
    payload: {
      username: `${role}-user`,
      displayName: role,
      role,
      monthlyLimit,
      password: memberPassword,
    },
  });
  assert.equal(created.statusCode, 200, created.body);
  assert.equal(
    (await new Members(f.db).list()).find((a) => a.id === created.json().id)
      ?.monthlyLimit,
    monthlyLimit,
  );
  const login = await f.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: `${role}-user`, password: memberPassword },
  });
  assert.equal(login.statusCode, 200);
  return {
    id: created.json().id as string,
    headers: { cookie: String(login.headers["set-cookie"]).split(";")[0] },
    owner,
  };
}

test("only owner manages accounts and settings; viewers can read assets and data but cannot mutate any API", async () => {
  const f = await fixture();
  try {
    const editor = await member(f, "editor"),
      viewer = await member(f, "viewer");
    for (const headers of [editor.headers, viewer.headers]) {
      for (const [method, url, payload] of [
        ["GET", "/api/members", undefined],
        ["POST", "/api/members", {}],
        ["PATCH", `/api/members/${editor.id}`, {}],
        ["DELETE", `/api/members/${editor.id}`, undefined],
        ["POST", `/api/members/${editor.id}/invitation`, {}],
        ["POST", "/api/workflow/settings", { apiKey: "should-not-save" }],
        ["POST", "/api/workspace/import", {}],
      ] as const) {
        const response = await f.app.inject({ method, url, payload, headers });
        assert.equal(
          response.statusCode,
          403,
          `${method} ${url}: ${response.body}`,
        );
      }
      for (const url of [
        "/api/workspace",
        "/api/workspace/changes?since=0",
        "/api/jobs/history",
        "/api/workflow/settings",
      ])
        assert.equal((await f.app.inject({ url, headers })).statusCode, 200);
    }
    for (const url of [
      "/api/jobs",
      "/api/jobs/queue/control",
      "/api/assets",
      "/api/shimo-image",
      "/api/assistant/chat",
      "/api/assistant/conversations",
      "/api/assistant/conversations/clear",
      "/api/assistant/conversations/fake/select",
    ]) {
      const response = await f.app.inject({
        method: "POST",
        url,
        payload: {},
        headers: viewer.headers,
      });
      assert.equal(response.statusCode, 403, `${url}: ${response.body}`);
    }
    assert.equal(
      (
        await f.app.inject({
          method: "PATCH",
          url: "/api/workspace",
          payload: { edits: [] },
          headers: viewer.headers,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "PATCH",
          url: "/api/workspace",
          payload: { edits: [{ path: ["concurrency"], before: 2, value: 3 }] },
          headers: editor.headers,
        })
      ).statusCode,
      403,
    );
    const edited = await f.app.inject({
      method: "PATCH",
      url: "/api/workspace",
      payload: {
        edits: [
          {
            path: ["products", f.product.id, "name"],
            before: f.product.name,
            value: "成员编辑",
          },
        ],
      },
      headers: editor.headers,
    });
    assert.equal(edited.statusCode, 200, edited.body);
    const uploaded = await f.app.inject({
      method: "POST",
      url: "/api/assets",
      headers: editor.headers,
      payload: { source: png },
    });
    assert.equal(uploaded.statusCode, 200);
    assert.equal(
      (
        await f.app.inject({
          url: uploaded.json().source,
          headers: viewer.headers,
        })
      ).statusCode,
      200,
    );
    const list = await f.app.inject({
      url: "/api/members",
      headers: editor.owner,
    });
    assert.equal(list.json().members.length, 3);
    assert.ok(
      !list.body.includes("password_hash") &&
        !list.body.includes(memberPassword),
    );
  } finally {
    await f.close();
  }
});

test("invitations are owner-created, hashed, single-use, expiring, revocable and persisted across restart", async (t) => {
  const f = await fixture();
  try {
    let owner = await loginHeaders(f.app);
    const created = await f.app.inject({
      method: "POST",
      url: "/api/members",
      headers: owner,
      payload: {
        username: "invited",
        displayName: "被邀请者",
        role: "viewer",
        monthlyLimit: 5,
      },
    });
    assert.equal(created.statusCode, 200);
    const { id, token } = created.json();
    const stored = (await f.db.query("SELECT * FROM workspace_invitations"))
      .rows[0];
    assert.notEqual(stored.token_hash, token);
    await f.reopen();
    owner = await loginHeaders(f.app);
    const read = () =>
      f.app.inject({
        method: "POST",
        url: "/api/auth/invitation",
        payload: { token },
      });
    assert.equal((await read()).json().username, "invited");
    const now = Date.now(),
      clock = t.mock.method(Date, "now", () => now + 8 * 24 * 3600000);
    assert.equal((await read()).statusCode, 410);
    clock.mock.restore();
    const accepted = await f.app.inject({
      method: "POST",
      url: "/api/auth/accept-invitation",
      payload: { token, password: memberPassword },
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    const memberHeaders = {
      cookie: String(accepted.headers["set-cookie"]).split(";")[0],
    };
    assert.equal((await read()).statusCode, 410);
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/auth/accept-invitation",
          payload: { token, password: "overwritten-password" },
        })
      ).statusCode,
      410,
    );
    const reset = await f.app.inject({
      method: "POST",
      url: `/api/members/${id}/invitation`,
      headers: owner,
    });
    assert.equal(
      reset.statusCode,
      409,
      "an owner cannot reset an active member's global password",
    );
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers: memberHeaders }))
        .statusCode,
      200,
    );
    await f.app.inject({
      method: "PATCH",
      url: `/api/members/${id}`,
      headers: owner,
      payload: {
        displayName: "被邀请者",
        role: "viewer",
        monthlyLimit: 5,
        enabled: false,
      },
    });
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers: memberHeaders }))
        .statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `/api/members/${id}/invitation`,
          headers: owner,
        })
      ).statusCode,
      409,
    );
  } finally {
    await f.close();
  }
});

test("owners require transfer; membership changes preserve global identity and passwords are hashed", async () => {
  const f = await fixture();
  try {
    const { id, headers, owner } = await member(f, "editor");
    const stored = (
      await f.db.query("SELECT password_hash FROM accounts WHERE id=$1", [id])
    ).rows[0];
    assert.match(stored.password_hash, /^scrypt\$/);
    assert.ok(!stored.password_hash.includes(memberPassword));
    for (const method of ["PATCH", "DELETE", "POST"] as const) {
      const url =
        method === "POST"
          ? "/api/members/owner/invitation"
          : "/api/members/owner";
      const payload =
        method === "PATCH"
          ? {
              displayName: "所有者",
              role: "viewer",
              enabled: false,
              monthlyLimit: 0,
            }
          : undefined;
      assert.equal(
        (await f.app.inject({ method, url, payload, headers: owner }))
          .statusCode,
        403,
      );
    }
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/members",
          headers: owner,
          payload: {
            username: "admin",
            displayName: "假的所有者",
            role: "editor",
            monthlyLimit: null,
          },
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "PATCH",
          url: `/api/members/${id}`,
          headers: owner,
          payload: {
            displayName: "查看成员",
            role: "viewer",
            enabled: true,
            monthlyLimit: 0,
          },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers })).statusCode,
      200,
    );
    const relogin = await f.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "editor-user", password: memberPassword },
    });
    const viewerHeaders = {
      cookie: String(relogin.headers["set-cookie"]).split(";")[0],
    };
    assert.equal(relogin.json().user.role, "viewer");
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/auth/password",
          headers: viewerHeaders,
          payload: {
            currentPassword: memberPassword,
            password: "new-member-password",
          },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers: viewerHeaders }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "DELETE",
          url: `/api/members/${id}`,
          headers: owner,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { username: "editor-user", password: "new-member-password" },
        })
      ).statusCode,
      200,
    );
    assert.equal((await f.workflows.repo.view()).products.length, 1);
  } finally {
    await f.close();
  }
});

test("image capacity is atomic while usage counts successful results once in their completion month", async (t) => {
  const f = await fixture();
  try {
    const { id, headers, owner } = await member(f, "editor", 2);
    const product = (await f.workflows.repo.view()).products[0];
    product.tasks.forEach((task) => (task.prompt = "已有提示词"));
    await f.workflows.repo.saveProduct(f.db, product);
    const pairs = f.product.tasks.map((task) => ({
      productId: f.product.id,
      taskId: task.id,
    }));
    const send = (
      commandId: string,
      targets = pairs.slice(0, 1),
      kind = "image",
    ) =>
      f.app.inject({
        method: "POST",
        url: "/api/jobs",
        headers,
        payload: { commandId, pairs: targets, kind },
      });
    const batch = await send("too-many", pairs, "full-workflow");
    assert.equal(batch.statusCode, 403, batch.body);
    assert.equal((await f.workflows.repo.view()).jobs.length, 0);
    const first = await send("first");
    assert.equal(first.statusCode, 200);
    assert.equal((await send("first")).statusCode, 200);
    assert.equal((await f.workflows.repo.view()).jobs[0].createdBy?.id, id);
    const results = await Promise.all([
      send("second", pairs.slice(1, 2)),
      send("third", pairs.slice(2, 3)),
    ]);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 403]);
    assert.equal((await f.workflows.repo.view()).jobs.length, 2);
    assert.equal(
      (await f.app.inject({ url: "/api/members", headers: owner }))
        .json()
        .members.find((a: any) => a.id === id).used,
      0,
    );
    const worker = new Worker(f.workflows, fakeProvider(counts()), () => {});
    for (let i = 0; i < 4; i++) {
      await f.due();
      assert.equal(await worker.step(), true);
    }
    const completed = (await f.workflows.repo.view()).jobs[0];
    await f.db.transaction((tx) =>
      recordImageSuccess(tx, completed, "default"),
    );
    assert.equal(
      (await new Members(f.db).list()).find((a) => a.id === id)?.used,
      2,
    );
    const now = Date.now(),
      clock = t.mock.method(Date, "now", () => now + 35 * 24 * 3600000);
    assert.equal(
      (await new Members(f.db).list()).find((a) => a.id === id)?.used,
      0,
    );
    const renewed = await f.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "editor-user", password: memberPassword },
    });
    headers.cookie = String(renewed.headers["set-cookie"]).split(";")[0];
    assert.equal((await send("new-month", pairs.slice(3, 4))).statusCode, 200);
    await f.due();
    await worker.step();
    await f.due();
    await worker.step();
    assert.equal(
      (await new Members(f.db).list()).find((a) => a.id === id)?.used,
      1,
    );
    clock.mock.restore();
  } finally {
    await f.close();
  }
});

test("failed submissions, failed downloads and cancellations do not count; recovered images count once", async (t) => {
  const f = await fixture();
  try {
    const { id, headers } = await member(f, "editor", 1);
    const used = async () =>
      (await new Members(f.db).list()).find((a) => a.id === id)?.used;
    const product = (await f.workflows.repo.view()).products[0];
    product.tasks[0].prompt = "已有提示词";
    await f.workflows.repo.saveProduct(f.db, product);
    const queued = await f.app.inject({
      method: "POST",
      url: "/api/jobs",
      headers,
      payload: {
        commandId: "retry-enqueue",
        kind: "image",
        pairs: [{ productId: product.id, taskId: product.tasks[0].id }],
      },
    });
    assert.equal(queued.statusCode, 200);
    const job = (await f.workflows.repo.view()).jobs[0];
    const control = (commandId: string, action: string) =>
      f.app.inject({
        method: "POST",
        url: `/api/jobs/${job.id}/control`,
        headers,
        payload: { commandId, action },
      });
    assert.equal((await control("cancel", "cancel")).statusCode, 200);
    assert.equal((await control("retry", "retry")).statusCode, 200);
    assert.equal((await control("retry", "retry")).statusCode, 200);
    assert.equal(await used(), 0);
    const retried = (await f.workflows.repo.view()).jobs[0];
    assert.equal(retried.lastRetriedBy?.id, id);
    const calls = counts();
    await new Worker(
      f.workflows,
      {
        ...fakeProvider(calls),
        async submit() {
          throw new ProviderError("平台明确拒绝", false, true);
        },
      },
      () => {},
    ).step();
    assert.equal((await f.workflows.repo.view()).jobs[0].status, "failed");
    assert.equal(await used(), 0);
    assert.equal((await control("retry-failure", "retry")).statusCode, 200);
    const worker = new Worker(f.workflows, fakeProvider(calls), () => {});
    await worker.step();
    assert.equal(await used(), 0);
    const download = t.mock.method(f.workflows.assets, "download", async () => {
      throw new Error("下载暂时失败");
    });
    await f.due();
    await worker.step();
    download.mock.restore();
    assert.equal(await used(), 0);
    assert.equal((await control("cancel-query", "cancel")).statusCode, 200);
    assert.equal((await control("continue-query", "retry")).statusCode, 200);
    await f.due();
    await worker.step();
    assert.equal(calls.submit, 1);
    assert.equal(
      (await new Members(f.db).list()).find((a) => a.id === id)?.used,
      1,
    );
    await f.reopen();
    assert.equal(await used(), 1);
  } finally {
    await f.close();
  }
});

test("assistant conversations and prompt analysis never consume image quota, even at a zero limit", async () => {
  const f = await fixture(),
    original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "测试回复" }],
        },
      ],
    });
  };
  try {
    const { id, headers } = await member(f, "editor", 0);
    const send = (turnId: string, conversationId?: string) =>
      f.app.inject({
        method: "POST",
        url: "/api/assistant/chat",
        headers,
        payload: {
          productId: f.product.id,
          message: "评估产品图",
          turnId,
          ...(conversationId ? { conversationId } : {}),
        },
      });
    const success = await send("allowed");
    assert.equal(success.statusCode, 200, success.body);
    assert.equal(calls, 1);
    assert.equal(
      (await send("allowed", success.json().conversation.id)).statusCode,
      200,
    );
    assert.equal(calls, 1);
    assert.equal((await send("another-turn")).statusCode, 200);
    assert.equal(calls, 2);
    const analysis = await f.app.inject({
      method: "POST",
      url: "/api/jobs",
      headers,
      payload: {
        commandId: "free-analysis",
        kind: "prompt",
        pairs: [{ productId: f.product.id, taskId: f.product.tasks[0].id }],
      },
    });
    assert.equal(analysis.statusCode, 200, analysis.body);
    assert.equal(
      await new Worker(f.workflows, fakeProvider(counts()), () => {}).step(),
      true,
    );
    assert.equal(
      (await new Members(f.db).list()).find((a) => a.id === id)?.used,
      0,
    );
  } finally {
    globalThis.fetch = original;
    await f.close();
  }
});

test("a password verification completed before reset cannot issue a session after reset", async () => {
  const f = await fixture();
  try {
    const { id } = await member(f, "editor");
    const accounts = new Accounts(f.db);
    const credentials = await accounts.authenticate(
      "editor-user",
      memberPassword,
    );
    await accounts.changePassword(
      id,
      memberPassword,
      "updated-member-password",
    );
    await assert.rejects(accounts.createSession(credentials), /账号已失效/);
    const current = await accounts.authenticate(
      "editor-user",
      "updated-member-password",
    );
    assert.equal((await accounts.createSession(current)).user.id, id);
  } finally {
    await f.close();
  }
});

test("public signup is absent, cross-site activation and password changes are rejected, login throttles guessing", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/auth/register",
          payload: {},
        })
      ).statusCode,
      401,
    );
    for (const url of ["/api/auth/accept-invitation", "/api/auth/password"])
      assert.equal(
        (
          await f.app.inject({
            method: "POST",
            url,
            headers: { origin: "https://attacker.invalid" },
            payload: {},
          })
        ).statusCode,
        403,
      );
    let status = 0;
    for (let i = 0; i < 21; i++)
      status = (
        await f.app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { username: "admin", password: "incorrect" },
        })
      ).statusCode;
    assert.equal(status, 429);
    assert.equal(actionAllowed("viewer", "choose-version"), false);
    assert.equal(actionAllowed("viewer", "download-version"), true);
    assert.equal(actionAllowed("editor", "settings"), false);
  } finally {
    await f.close();
  }
});
