import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, loginHeaders, password } from "../../support/production.js";
import { Members } from "../../../server/production/members.js";
import { migrate } from "../../../server/production/database.js";
import { WorkspaceDirectory } from "../../../server/production/workspace-directory.js";

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function editor(f: Fixture, username: string) {
  const member = await new Members(f.db).create({
    username,
    displayName: username,
    password,
    role: "editor",
    monthlyLimit: null,
  });
  const login = await f.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password },
  });
  assert.equal(login.statusCode, 200, login.body);
  return {
    id: member.id,
    headers: { cookie: String(login.headers["set-cookie"]).split(";")[0] },
  };
}
async function read(f: Fixture, headers: Record<string, string>) {
  const response = await f.app.inject({
    url: "/api/workflow/settings",
    headers,
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}
async function save(
  f: Fixture,
  headers: Record<string, string>,
  payload: object,
) {
  const response = await f.app.inject({
    method: "POST",
    url: "/api/workflow/settings",
    headers,
    payload,
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}

test("personal models are isolated by account and workspace, survive restart, and never change shared data or cursors", async () => {
  const f = await fixture();
  try {
    const a = await editor(f, "settings-a"),
      b = await editor(f, "settings-b"),
      owner = await loginHeaders(f.app);
    const initial = await read(f, owner),
      before = await f.workflows.repo.view(),
      cursor = await f.workflows.repo.cursor();
    await save(f, a.headers, {
      imageSize: "2K",
      aspectRatio: "4:3",
    });
    await save(f, b.headers, {
      imageSize: "4K",
      aspectRatio: "16:9",
    });
    await save(f, owner, { imageSize: "1K" });
    assert.equal((await read(f, a.headers)).imageSize, "2K");
    assert.equal((await read(f, b.headers)).imageSize, "4K");
    assert.equal((await read(f, owner)).imageSize, "1K");
    assert.deepEqual(await f.workflows.repo.view(), before);
    assert.equal(await f.workflows.repo.cursor(), cursor);
    const created = await f.app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: a.headers,
      payload: { name: "另一个工作区" },
    });
    assert.equal(created.statusCode, 200, created.body);
    const otherHeaders = { ...a.headers, "x-workspace-id": created.json().id };
    assert.equal((await read(f, otherHeaders)).imageSize, initial.imageSize);
    await save(f, otherHeaders, {
      imageSize: "1K",
      promptModel: "ep-other-workspace",
    });
    assert.equal((await read(f, a.headers)).imageSize, "2K");
    await f.reopen();
    assert.equal((await read(f, a.headers)).imageSize, "2K");
    assert.equal((await read(f, b.headers)).imageSize, "4K");
    assert.equal(
      (await read(f, otherHeaders)).promptModel,
      "ep-other-workspace",
    );
    const shared = await f.app.inject({
      url: "/api/workspace",
      headers: a.headers,
    });
    assert.equal(shared.json().settings.imageSize, before.settings.imageSize);
  } finally {
    await f.close();
  }
});

test("only the owner changes workspace conversation model, mode and node; members use shared values while keeping personal image settings", async () => {
  const f = await fixture();
  try {
    const a = await editor(f, "shared-a"),
      b = await editor(f, "shared-b"),
      owner = await loginHeaders(f.app);
    await save(f, a.headers, { imageSize: "2K" });
    await save(f, b.headers, { imageSize: "4K" });
    const before = await read(f, a.headers);
    for (const field of [
      { promptModel: "ep-blocked" },
      { promptProvider: "doubao" },
      { mode: "live" },
      { baseUrl: "https://grsaiapi.com" },
    ]) {
      const denied = await f.app.inject({
        method: "POST",
        url: "/api/workflow/settings",
        headers: a.headers,
        payload: { imageSize: "1K", ...field },
      });
      assert.equal(denied.statusCode, 403, denied.body);
      assert.deepEqual(await read(f, a.headers), before);
    }
    await save(f, owner, {
      promptModel: "ep-shared",
      mode: "live",
      baseUrl: "https://grsaiapi.com",
    });
    for (const user of [a, b]) {
      const config = await read(f, user.headers);
      assert.equal(config.promptModel, "ep-shared");
      assert.equal(config.baseUrl, "https://grsaiapi.com");
      assert.equal(config.mode, "live");
      assert.equal(config.imageSize, user === a ? "2K" : "4K");
    }
    const created = await f.app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: owner,
      payload: { name: "另一共享配置" },
    });
    const other = await read(f, {
      ...owner,
      "x-workspace-id": created.json().id,
    });
    assert.notEqual(other.promptModel, "ep-shared");
    assert.notEqual(other.baseUrl, "https://grsaiapi.com");
  } finally {
    await f.close();
  }
});

test("018 preserves the owner's previous service choices, removes editor overrides, and retains personal image settings and credentials", async () => {
  const f = await fixture();
  try {
    const user = await editor(f, "upgrade-shared"),
      owner = await loginHeaders(f.app);
    for (const [id, document] of [
      [
        "owner",
        {
          promptModel: "ep-owner-upgrade",
          promptProvider: "doubao",
          baseUrl: "https://grsaiapi.com",
          imageSize: "4K",
        },
      ],
      [
        user.id,
        {
          promptModel: "ep-editor-ignored",
          baseUrl: "https://grsai.dakka.com.cn",
          imageSize: "2K",
        },
      ],
    ] as const)
      await f.db.query(
        "INSERT INTO member_generation_settings(workspace_id,account_id,document,updated_at) VALUES('default',$1,$2,1)",
        [id, document],
      );
    const keys = [await f.workflows.key(), await f.workflows.key("doubao")];
    await f.db.query("DELETE FROM schema_migrations WHERE version='018.sql'");
    await migrate(f.db);
    for (const headers of [owner, user.headers]) {
      const config = await read(f, headers);
      assert.equal(config.promptModel, "ep-owner-upgrade");
      assert.equal(config.baseUrl, "https://grsaiapi.com");
      assert.equal(config.imageSize, headers === owner ? "4K" : "2K");
    }
    for (const row of (
      await f.db.query("SELECT document FROM member_generation_settings")
    ).rows) {
      assert.equal(Object.hasOwn(row.document, "promptModel"), false);
      assert.equal(Object.hasOwn(row.document, "baseUrl"), false);
    }
    assert.deepEqual(
      [await f.workflows.key(), await f.workflows.key("doubao")],
      keys,
    );
    await migrate(f.db);
    assert.equal((await read(f, user.headers)).promptModel, "ep-owner-upgrade");
  } finally {
    await f.close();
  }
});

test("analysis and image jobs freeze their initiator's models and retries retain the frozen config", async () => {
  const f = await fixture();
  try {
    const a = await editor(f, "jobs-a"),
      b = await editor(f, "jobs-b");
    await save(f, a.headers, {
      imageModel: "nano-banana-2",
      imageSize: "2K",
    });
    await save(f, b.headers, { imageSize: "4K" });
    await save(f, await loginHeaders(f.app), {
      promptModel: "ep-workspace",
      baseUrl: "https://grsaiapi.com",
    });
    const actorA = (await new WorkspaceDirectory(f.db).context(
      a.id,
      "default",
    ))!;
    const actorB = (await new WorkspaceDirectory(f.db).context(
      b.id,
      "default",
    ))!;
    await f.workflows.enqueue(
      randomUUID(),
      [{ productId: f.product.id, taskId: f.product.tasks[0].id }],
      "full-workflow",
      actorA,
    );
    await f.workflows.enqueue(
      randomUUID(),
      [{ productId: f.product.id, taskId: f.product.tasks[1].id }],
      "full-workflow",
      actorB,
    );
    const jobs = (await f.workflows.repo.view()).jobs;
    assert.equal(jobs.length, 4);
    for (const job of jobs) {
      const isA = job.createdBy?.id === a.id;
      assert.equal(job.config.promptModel, "ep-workspace");
      assert.equal(job.config.baseUrl, "https://grsaiapi.com");
      assert.equal(job.config.imageSize, isA ? "2K" : "4K");
    }
    await save(f, a.headers, { imageSize: "1K" });
    await save(f, await loginHeaders(f.app), {
      promptModel: "ep-new-workspace",
    });
    const analysis = jobs.find(
      (job) => job.kind === "prompt-set" && job.createdBy?.id === a.id,
    )!;
    analysis.status = "failed";
    await f.workflows.repo.saveJob(f.db, analysis);
    await f.workflows.control(
      analysis.id,
      "retry",
      { commandId: randomUUID() },
      actorB,
    );
    const retried = (await f.workflows.repo.view()).jobs.find(
      (job) => job.id === analysis.id,
    )!;
    assert.equal(retried.config.promptModel, "ep-workspace");
    assert.equal(retried.config.imageSize, "2K");
  } finally {
    await f.close();
  }
});

test("assistant uses the owner-managed workspace model and shared key for every member", async () => {
  const f = await fixture(),
    original = globalThis.fetch;
  try {
    const a = await editor(f, "chat-a"),
      b = await editor(f, "chat-b");
    await save(f, await loginHeaders(f.app), {
      promptModel: "ep-workspace-chat",
    });
    const calls: string[] = [];
    globalThis.fetch = async (_url, options) => {
      calls.push(JSON.parse(options?.body as string).model);
      assert.equal(
        (options?.headers as any).Authorization,
        "Bearer fake-doubao-key",
      );
      return Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "已收到" }],
          },
        ],
      });
    };
    for (const user of [a, b]) {
      const response = await f.app.inject({
        method: "POST",
        url: "/api/assistant/chat",
        headers: user.headers,
        payload: { message: "你好" },
      });
      assert.equal(response.statusCode, 200, response.body);
    }
    assert.deepEqual(calls, ["ep-workspace-chat", "ep-workspace-chat"]);
  } finally {
    globalThis.fetch = original;
    await f.close();
  }
});

test("workspace credentials have a separate owner-only endpoint and leave personal models unchanged", async () => {
  const f = await fixture();
  try {
    const a = await editor(f, "credential-editor"),
      owner = await loginHeaders(f.app);
    await save(f, a.headers, { imageSize: "2K" });
    const before = await read(f, a.headers);
    for (const payload of [{ apiKey: "forbidden" }, { clearPromptKey: true }]) {
      const result = await f.app.inject({
        method: "POST",
        url: "/api/workflow/credentials",
        headers: a.headers,
        payload,
      });
      assert.equal(result.statusCode, 403, result.body);
    }
    const result = await f.app.inject({
      method: "POST",
      url: "/api/workflow/credentials",
      headers: owner,
      payload: { apiKey: "shared-owner-key" },
    });
    assert.equal(result.statusCode, 200, result.body);
    assert.deepEqual(Object.keys(result.json()).sort(), [
      "hasKey",
      "hasPromptKey",
    ]);
    assert.deepEqual(await read(f, a.headers), before);
    assert.equal(await f.workflows.key(), "shared-owner-key");
  } finally {
    await f.close();
  }
});

test("017 seeds members from legacy defaults, preserves keys and jobs, and never overwrites saved preferences on restart", async () => {
  const f = await fixture();
  try {
    const a = await editor(f, "migration-editor");
    await f.workflows.updateSettings({
      promptModel: "ep-legacy",
      imageSize: "2K",
    });
    await f.workflows.enqueue(
      randomUUID(),
      [{ productId: f.product.id, taskId: f.product.tasks[0].id }],
      "prompt-set",
    );
    const before = await f.workflows.repo.view(),
      key = await f.workflows.key();
    await f.db.query("DROP TABLE member_generation_settings");
    await f.db.query("DELETE FROM schema_migrations WHERE version='017.sql'");
    await migrate(f.db);
    assert.equal((await read(f, a.headers)).promptModel, "ep-legacy");
    assert.equal((await read(f, await loginHeaders(f.app))).imageSize, "2K");
    assert.deepEqual(await f.workflows.repo.view(), before);
    assert.equal(await f.workflows.key(), key);
    await save(f, a.headers, { imageSize: "4K" });
    await migrate(f.db);
    assert.equal((await read(f, a.headers)).imageSize, "4K");
    assert.deepEqual((await f.db.query("PRAGMA foreign_key_check")).rows, []);
  } finally {
    await f.close();
  }
});
