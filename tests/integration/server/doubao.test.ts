import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  fixture,
  fakeProvider,
  counts,
  pairs,
  png,
  secret,
  loginHeaders,
} from "../../support/production.js";
import { Credentials } from "../../../server/production/credentials.js";
import { Worker } from "../../../server/production/worker.js";
import { database, migrate } from "../../../server/production/database.js";
import {
  DOUBAO_BASE_URL,
  DOUBAO_DEFAULT_MODEL,
} from "../../../shared/doubao.js";
import { GrsaiProvider } from "../../../server/production/provider.js";
import { ROLES } from "../../../shared/model.js";

const output = (text: string) =>
  Response.json({
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text }] }],
  });

test("assistant distinguishes unactivated models from invalid user requests and upstream authorization from login", async () => {
  const f = await fixture(),
    original = globalThis.fetch;
  try {
    const headers = await loginHeaders(f.app);
    const payload = { messages: [{ role: "user", content: "你好" }] };
    globalThis.fetch = async () =>
      Response.json(
        {
          error: {
            code: "ModelNotOpen",
            message: "fake-doubao-key private account detail",
          },
        },
        { status: 404, headers: { "x-request-id": "upstream-404" } },
      );
    const failed = await f.app.inject({
      method: "POST",
      url: "/api/assistant/chat",
      headers,
      payload,
    });
    assert.equal(failed.statusCode, 422);
    assert.equal(failed.json().upstreamStatus, 404);
    assert.equal(failed.json().code, "ModelNotOpen");
    assert.equal(failed.json().action, "open-model");
    assert.match(failed.json().error, /开通管理/);
    assert.ok(!failed.body.includes("fake-doubao-key"));
    const invalid = await f.app.inject({
      method: "POST",
      url: "/api/assistant/chat",
      headers,
      payload: { messages: [] },
    });
    assert.equal(invalid.statusCode, 400);
    globalThis.fetch = async () =>
      Response.json(
        { error: { code: "AuthenticationError" } },
        { status: 401 },
      );
    const denied = await f.app.inject({
      method: "POST",
      url: "/api/assistant/chat",
      headers,
      payload,
    });
    assert.equal(denied.statusCode, 422);
    assert.equal(denied.json().action, "check-key");
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers })).statusCode,
      200,
    );
  } finally {
    globalThis.fetch = original;
    await f.close();
  }
});

test("existing queued analysis keeps its original Grsai model and credential", async () => {
  const f = await fixture();
  try {
    await f.workflows.enqueue(randomUUID(), pairs(f.product), "prompt-set");
    const job = (await f.workflows.repo.view()).jobs[0];
    delete job.config.promptProvider;
    job.config.promptModel = "gemini-3.1-pro";
    await f.workflows.repo.saveJob(f.db, job);
    await f.workflows.updateSettings({ clearPromptKey: true });
    const provider = fakeProvider(counts()),
      analyze = provider.analyze;
    provider.analyze = async (...args) => {
      assert.equal(args[2].promptModel, "gemini-3.1-pro");
      assert.equal(args[3], "fake-platform-key");
      return analyze(...args);
    };
    await f.due();
    await new Worker(f.workflows, provider).step();
    assert.equal((await f.workflows.repo.view()).jobs[0].status, "completed");
  } finally {
    await f.close();
  }
});

test("Doubao and Grsai credentials are encrypted, independent and survive reopening without entering backups", async () => {
  const f = await fixture();
  try {
    await f.workflows.updateSettings({
      promptApiKey: "Bearer new-doubao-key",
      apiKey: "  ",
    });
    assert.equal(await f.workflows.key(), "fake-platform-key");
    assert.equal(await f.workflows.key("doubao"), "new-doubao-key");
    const row = (await f.db.query("SELECT * FROM workspace")).rows[0];
    assert.equal(
      new Credentials(secret).decrypt(row.prompt_credential),
      "new-doubao-key",
    );
    assert.ok(!row.prompt_credential.includes("new-doubao-key"));
    await f.reopen();
    assert.equal(await f.workflows.key("doubao"), "new-doubao-key");
    const settings = await f.workflows.settings();
    assert.equal(settings.hasKey, true);
    assert.equal(settings.hasPromptKey, true);
    const exposed = JSON.stringify([settings, await f.workflows.repo.view()]);
    assert.ok(!exposed.includes("new-doubao-key"));
    assert.ok(!exposed.includes(row.prompt_credential));
    await f.workflows.updateSettings({ clearPromptKey: true });
    assert.equal((await f.workflows.settings()).hasPromptKey, false);
    assert.equal(await f.workflows.key(), "fake-platform-key");
    await assert.rejects(f.workflows.key("doubao"), /豆包/);
    await assert.rejects(
      f.workflows.enqueue(randomUUID(), pairs(f.product), "prompt-set"),
      /豆包/,
    );
    await f.workflows.updateSettings({
      promptApiKey: "new-doubao-key",
      clearKey: true,
    });
    assert.equal((await f.workflows.settings()).hasKey, false);
    assert.equal(
      (await f.workflows.enqueue(randomUUID(), pairs(f.product), "prompt-set"))
        .count,
      1,
    );
    const provider = fakeProvider(counts());
    provider.analyze = async (...args) => {
      assert.equal(args[3], "new-doubao-key");
      return fakeProvider(counts()).analyze(...args);
    };
    await new Worker(f.workflows, provider).step();
    await assert.rejects(
      f.workflows.enqueue(randomUUID(), pairs(f.product), "image"),
      /Grsai/,
    );
  } finally {
    await f.close();
  }
});

test("migration upgrades old prompt settings while preserving Grsai credentials", async () => {
  const db = database(":memory:");
  try {
    const sql = await readFile(
      new URL(
        "../../../server/production/sqlite-migrations/001.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.query(sql);
    await db.query(
      "CREATE TABLE schema_migrations(version TEXT PRIMARY KEY, checksum TEXT NOT NULL)",
    );
    await db.query(
      "INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)",
      ["001.sql", createHash("sha256").update(sql).digest("hex")],
    );
    await db.query(
      "INSERT INTO workspace(id,document,credential) VALUES($1,$2,$3)",
      [
        "default",
        {
          settings: {
            promptModel: "gemini-3.1-pro",
            imageModel: "nano-banana-2",
          },
        },
        "encrypted-image-key",
      ],
    );
    await migrate(db);
    await migrate(db);
    const row = (await db.query("SELECT * FROM workspace")).rows[0];
    assert.equal(row.document.settings.promptModel, DOUBAO_DEFAULT_MODEL);
    assert.equal(row.document.settings.promptProvider, "doubao");
    assert.equal(row.document.settings.imageModel, "nano-banana-2");
    assert.equal(row.credential, "encrypted-image-key");
    assert.equal(row.prompt_credential, null);
  } finally {
    await db.close();
  }
});

test("analysis sends images to Doubao Responses while image generation uses Grsai", async () => {
  const f = await fixture(),
    original = globalThis.fetch;
  const calls: { url: string; body: any; authorization: string }[] = [];
  globalThis.fetch = async (url, options) => {
    calls.push({
      url: String(url),
      body: JSON.parse(options?.body as string),
      authorization: (options?.headers as any).Authorization,
    });
    if (String(url).endsWith("/responses"))
      return output(
        JSON.stringify({
          style: "统一留白布局",
          images: ROLES.map((role, i) => ({
            role,
            layout: "准确展示实拍产品",
            copy: [
              i === 0
                ? "25 Pack 24 x 28 cm Product Size"
                : i === 6
                  ? "Test Made For Your Everyday Packing"
                  : "Thoughtful Design For Your Everyday Packing",
            ],
            photoIndices: [0],
          })),
        }),
      );
    return Response.json({ id: "remote-image" });
  };
  try {
    const state = await f.workflows.repo.view(),
      provider = new GrsaiProvider(f.workflows.assets);
    await provider.analyze(
      f.product,
      state.common,
      state.settings,
      await f.workflows.key("doubao"),
      new AbortController().signal,
    );
    await provider.submit(
      "image prompt",
      [f.product.photo],
      state.settings,
      await f.workflows.key(),
      new AbortController().signal,
    );
    assert.equal(calls[0].url, `${DOUBAO_BASE_URL}/responses`);
    assert.equal(calls[0].authorization, "Bearer fake-doubao-key");
    assert.equal(calls[0].body.model, DOUBAO_DEFAULT_MODEL);
    assert.equal(calls[0].body.stream, true);
    assert.equal(calls[0].body.store, false);
    assert.deepEqual(calls[0].body.thinking, { type: "disabled" });
    assert.equal(
      calls[0].body.input[0].content.filter(
        (c: any) => c.type === "input_image",
      ).length,
      1,
    );
    assert.ok(
      calls[0].body.input[0].content.some(
        (c: any) =>
          c.text?.includes("产品实拍图 0") && c.text.includes("图片 1"),
      ),
    );
    assert.equal(calls[1].url, "https://grsai.dakka.com.cn/v1/api/generate");
    assert.equal(calls[1].authorization, "Bearer fake-platform-key");
  } finally {
    globalThis.fetch = original;
    await f.close();
  }
});

test("card assistant includes product, prompt, selected result and conversation history and uses only Doubao key", async () => {
  const f = await fixture(),
    original = globalThis.fetch;
  let body: any;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), `${DOUBAO_BASE_URL}/responses`);
    assert.equal(
      (options?.headers as any).Authorization,
      "Bearer fake-doubao-key",
    );
    body = JSON.parse(options?.body as string);
    return output("可以改善留白与产品比例。");
  };
  try {
    const product = (await f.workflows.repo.view()).products[0],
      task = product.tasks[0];
    const source = await f.workflows.assets.normalize(png);
    task.prompt = "当前卡片提示词";
    task.versions.push({
      id: "result-v1",
      source,
      prompt: "生成结果时的提示词",
      number: 1,
      createdAt: Date.now(),
      origin: "generated",
    });
    task.primaryId = "result-v1";
    await f.workflows.repo.saveProduct(f.db, product);
    await f.workflows.updateSettings({ clearKey: true });
    const headers = await loginHeaders(f.app);
    const payload = {
      productId: product.id,
      taskId: task.id,
      messages: [{ role: "user", content: "如何优化？" }],
    };
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/assistant/chat",
          payload,
        })
      ).statusCode,
      401,
    );
    const response = await f.app.inject({
      method: "POST",
      url: "/api/assistant/chat",
      headers,
      payload,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().text, "可以改善留白与产品比例。");
    const content = body.input[1].content;
    const context = JSON.parse(content[0].text.split("\n").slice(1).join("\n"));
    assert.equal(context.product.name, product.name);
    assert.equal(context.product.facts, product.facts);
    assert.equal(context.card.prompt, task.prompt);
    assert.equal(context.card.result.generationPrompt, "生成结果时的提示词");
    assert.equal(
      content.filter((c: any) => c.type === "input_image").length,
      3,
    );
    assert.ok(content.some((c: any) => c.text?.includes("生成结果 V1")));
    assert.equal(body.input.at(-1).content[0].text, "如何优化？");
    assert.equal((await f.workflows.repo.view()).jobs.length, 0);
    const followup = await f.app.inject({
      method: "POST",
      url: "/api/assistant/chat",
      headers,
      payload: {
        ...payload,
        messages: [
          ...payload.messages,
          { role: "assistant", content: "已有建议" },
          { role: "user", content: "给我完整提示词" },
        ],
      },
    });
    assert.equal(followup.statusCode, 200);
    assert.equal(body.input.at(-2).role, "assistant");
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/assistant/chat",
          headers,
          payload: { ...payload, taskId: "missing" },
        })
      ).statusCode,
      404,
    );
    await f.workflows.updateSettings({ clearPromptKey: true });
    assert.match(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/assistant/chat",
          headers,
          payload,
        })
      ).body,
      /豆包/,
    );
  } finally {
    globalThis.fetch = original;
    await f.close();
  }
});
