import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, loginHeaders } from "../../support/production.js";
import { AssistantConversations } from "../../../server/production/assistant-conversations.js";
import { newProduct } from "../../../shared/model.js";
import { migrate } from "../../../server/production/database.js";

const answer = (text: string) =>
  Response.json({
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text }] }],
  });

test("upgrading existing conversations preserves messages and selects one history per card", async () => {
  const f = await fixture();
  try {
    const storage = new AssistantConversations(f.db);
    const context = { productId: f.product.id, taskId: f.product.tasks[0].id };
    const first = await storage.create(context),
      second = await storage.create(context);
    const turnId = randomUUID();
    const started = await storage.start(
      first.id,
      turnId,
      "升级前的问题",
      "old-model",
    );
    await storage.finish(
      first.id,
      turnId,
      "completed",
      "升级前的回答",
      "",
      undefined,
      started.attempt,
    );
    await f.db.query(
      "UPDATE assistant_conversations SET updated_at=$2 WHERE id=$1",
      [first.id, 100],
    );
    await f.db.query(
      "UPDATE assistant_conversations SET updated_at=$2 WHERE id=$1",
      [second.id, 200],
    );
    await f.db.query("DROP INDEX assistant_selected_context");
    await f.db.query(
      "ALTER TABLE assistant_conversations DROP COLUMN selected",
    );
    await f.db.query("DELETE FROM schema_migrations WHERE version=$1", [
      "005.sql",
    ]);
    await migrate(f.db);
    await migrate(f.db);
    assert.equal((await storage.list(context))[0].id, second.id);
    const restored = await storage.get(first.id);
    assert.equal(restored.turns[0].userText, "升级前的问题");
    assert.equal(restored.turns[0].assistantText, "升级前的回答");
    await storage.select(first.id);
    assert.equal((await storage.list(context))[0].id, first.id);
  } finally {
    await f.close();
  }
});

test("card conversations survive reopening, stay isolated and supply stored history to the next model call", async () => {
  const f = await fixture(),
    original = globalThis.fetch;
  const calls: any[] = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options?.body as string);
    calls.push(body);
    return answer(`豆包回复：${body.input.at(-1).content[0].text}`);
  };
  try {
    let headers = await loginHeaders(f.app);
    const firstContext = {
      productId: f.product.id,
      taskId: f.product.tasks[0].id,
    };
    const create = async (context: object) => {
      const response = await f.app.inject({
        method: "POST",
        url: "/api/assistant/conversations",
        headers,
        payload: context,
      });
      assert.equal(response.statusCode, 200);
      return response.json();
    };
    const first = await create(firstContext),
      second = await create({ ...firstContext, taskId: f.product.tasks[1].id });
    const otherProduct = newProduct("OTHER", "另一产品", "独立资料") as any;
    await f.workflows.repo.saveProduct(f.db, otherProduct);
    const third = await create({
      productId: otherProduct.id,
      taskId: otherProduct.tasks[0].id,
    });
    const send = (id: string, message: string, turnId = randomUUID()) =>
      f.app.inject({
        method: "POST",
        url: "/api/assistant/chat",
        headers,
        payload: { conversationId: id, turnId, message },
      });
    const turnId = randomUUID();
    assert.equal(
      (await send(first.id, "请记住这张卡片需要暖色背景", turnId)).statusCode,
      200,
    );
    assert.equal(
      (await send(second.id, "第二张卡片用冷色背景")).statusCode,
      200,
    );
    assert.equal((await send(third.id, "另一个产品保持白底")).statusCode, 200);
    await f.reopen();
    headers = await loginHeaders(f.app);
    const restored = await f.app.inject({
      url: `/api/assistant/conversations/${first.id}`,
      headers,
    });
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.json().turns.length, 1);
    assert.equal(
      restored.json().turns[0].userText,
      "请记住这张卡片需要暖色背景",
    );
    assert.equal(
      restored.json().turns[0].assistantText,
      "豆包回复：请记住这张卡片需要暖色背景",
    );
    assert.equal(calls.length, 3); // Loading history never calls a paid provider.
    assert.equal(
      (await send(first.id, "请记住这张卡片需要暖色背景", turnId)).statusCode,
      200,
    );
    assert.equal(calls.length, 3); // Replaying the same turn cannot submit it twice.
    await send(first.id, "继续优化同一张图");
    const history = JSON.stringify(calls.at(-1).input);
    assert.match(history, /暖色背景/);
    assert.doesNotMatch(history, /冷色背景|另一个产品保持白底/);
    assert.equal(calls.at(-1).input.at(-2).role, "assistant");
    const list = await f.app.inject({
      url: `/api/assistant/conversations?productId=${firstContext.productId}&taskId=${firstContext.taskId}`,
      headers,
    });
    assert.deepEqual(
      list.json().conversations.map((item: any) => item.id),
      [first.id],
    );
    const fresh = await create(firstContext);
    assert.notEqual(fresh.id, first.id);
    assert.equal(fresh.turns.length, 0);
    assert.equal(
      (
        await f.app.inject({
          url: `/api/assistant/conversations/${first.id}`,
          headers,
        })
      ).json().turns.length,
      2,
    );
    await f.app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${first.id}/select`,
      headers,
      payload: {},
    });
    await f.reopen();
    headers = await loginHeaders(f.app);
    const selected = await f.app.inject({
      url: `/api/assistant/conversations?productId=${firstContext.productId}&taskId=${firstContext.taskId}`,
      headers,
    });
    assert.equal(selected.json().conversations[0].id, first.id);
    assert.equal(
      (await f.app.inject({ url: `/api/assistant/conversations/${first.id}` }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/assistant/chat",
          headers,
          payload: {
            conversationId: first.id,
            productId: otherProduct.id,
            message: "不能串产品",
          },
        })
      ).statusCode,
      409,
    );
  } finally {
    globalThis.fetch = original;
    await f.close();
  }
});

test("failed and interrupted questions persist and retry only after an explicit request", async () => {
  const f = await fixture(),
    original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ error: { code: "ModelNotOpen" } }, { status: 404 });
  };
  try {
    let headers = await loginHeaders(f.app);
    const context = { productId: f.product.id, taskId: f.product.tasks[0].id };
    const conversation = (
      await f.app.inject({
        method: "POST",
        url: "/api/assistant/conversations",
        headers,
        payload: context,
      })
    ).json();
    const turnId = randomUUID(),
      message = "这条失败的问题也要保存";
    const send = (retry = false) =>
      f.app.inject({
        method: "POST",
        url: "/api/assistant/chat",
        headers,
        payload: { conversationId: conversation.id, turnId, message, retry },
      });
    const failure = await send();
    assert.equal(failure.statusCode, 422);
    assert.equal(failure.json().conversation.turns[0].status, "failed");
    await f.reopen();
    headers = await loginHeaders(f.app);
    const restored = (
      await f.app.inject({
        url: `/api/assistant/conversations/${conversation.id}`,
        headers,
      })
    ).json();
    assert.equal(restored.turns[0].userText, message);
    assert.equal(restored.turns[0].errorAction, "open-model");
    assert.equal(calls, 1);
    assert.equal((await send()).statusCode, 409);
    assert.equal(calls, 1);
    globalThis.fetch = async () => {
      calls++;
      return answer("现在可以继续");
    };
    const success = await send(true);
    assert.equal(success.statusCode, 200);
    assert.equal(success.json().conversation.turns.length, 1);
    assert.equal(
      success.json().conversation.turns[0].assistantText,
      "现在可以继续",
    );
    const storage = new AssistantConversations(f.db),
      pendingId = randomUUID();
    await storage.start(
      conversation.id,
      pendingId,
      "模拟服务退出时的未完成问题",
      "test-model",
    );
    await f.reopen();
    headers = await loginHeaders(f.app);
    const recovered = (
      await f.app.inject({
        url: `/api/assistant/conversations/${conversation.id}`,
        headers,
      })
    ).json();
    assert.equal(recovered.turns[1].status, "interrupted");
    assert.match(recovered.turns[1].error, /服务重启/);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
    await f.close();
  }
});

test("cancelling a saved turn aborts its request, and late attempts cannot overwrite a retry", async () => {
  const f = await fixture(),
    original = globalThis.fetch;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  globalThis.fetch = async (_url, options) => {
    entered();
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (options?.signal?.aborted) abort();
      else options?.signal?.addEventListener("abort", abort, { once: true });
    });
  };
  try {
    const headers = await loginHeaders(f.app);
    const conversation = (
      await f.app.inject({
        method: "POST",
        url: "/api/assistant/conversations",
        headers,
        payload: { productId: f.product.id, taskId: f.product.tasks[0].id },
      })
    ).json();
    const turnId = randomUUID();
    const request = f.app
      .inject({
        method: "POST",
        url: "/api/assistant/chat",
        headers,
        payload: {
          conversationId: conversation.id,
          turnId,
          message: "停止后保留问题",
        },
      })
      .then((result) => result);
    await started;
    const cancelled = await f.app.inject({
      method: "POST",
      url: `/api/assistant/conversations/${conversation.id}/turns/${turnId}/cancel`,
      headers,
      payload: {},
    });
    assert.equal(cancelled.json().turns[0].status, "cancelled");
    assert.equal((await request).statusCode, 409);
    const storage = new AssistantConversations(f.db);
    const retry = await storage.start(
      conversation.id,
      turnId,
      "停止后保留问题",
      "test-model",
      true,
    );
    await storage.finish(
      conversation.id,
      turnId,
      "cancelled",
      undefined,
      "过期请求的错误",
      undefined,
      retry.attempt - 1,
    );
    assert.equal(
      (await storage.get(conversation.id)).turns[0].status,
      "running",
    );
    await storage.finish(
      conversation.id,
      turnId,
      "completed",
      "重试的新结果",
      "",
      undefined,
      retry.attempt,
    );
    assert.equal(
      (await storage.get(conversation.id)).turns[0].assistantText,
      "重试的新结果",
    );
    await assert.rejects(
      storage.start(conversation.id, turnId, "相同 ID 修改问题", "test-model"),
      /内容不能修改/,
    );
    const attempts = await Promise.allSettled([
      storage.start(conversation.id, randomUUID(), "并发一", "test"),
      storage.start(conversation.id, randomUUID(), "并发二", "test"),
    ]);
    assert.equal(
      attempts.filter((item) => item.status === "fulfilled").length,
      1,
    );
  } finally {
    globalThis.fetch = original;
    await f.close();
  }
});
