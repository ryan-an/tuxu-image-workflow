import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, loginHeaders } from "../../support/production.js";
import { AssistantConversations } from "../../../server/production/assistant-conversations.js";

test("clearing card history deletes persisted turns, isolates contexts and resets model history", async () => {
  const f = await fixture(),
    original = globalThis.fetch;
  try {
    const headers = await loginHeaders(f.app);
    const storage = new AssistantConversations(f.db);
    const context = { productId: f.product.id, taskId: f.product.tasks[0].id };
    const old = await storage.create(context, [
      { role: "user", content: "清空前的旧问题" },
      { role: "assistant", content: "清空前的旧回答" },
    ]);
    const recent = await storage.create(context);
    const otherCard = await storage.create({
      ...context,
      taskId: f.product.tasks[1].id,
    });
    const product = await storage.create({ productId: f.product.id });
    const general = await storage.create({});
    const clear = (payload = context, authenticated = true) =>
      f.app.inject({
        method: "POST",
        url: "/api/assistant/conversations/clear",
        ...(authenticated ? { headers } : {}),
        payload,
      });
    assert.equal((await clear(context, false)).statusCode, 401);
    assert.equal(
      (await clear({ ...context, taskId: "missing-card" })).statusCode,
      404,
    );
    const turnId = randomUUID();
    const started = await storage.start(
      recent.id,
      turnId,
      "进行中的问题",
      "test-model",
    );
    const busy = await clear();
    assert.equal(busy.statusCode, 409);
    assert.match(busy.json().error, /先停止回复/);
    assert.equal((await storage.list(context)).length, 2);
    await storage.finish(
      recent.id,
      turnId,
      "cancelled",
      "部分回复",
      "",
      undefined,
      started.attempt,
    );
    const cleared = await clear();
    assert.equal(cleared.statusCode, 200);
    assert.deepEqual(cleared.json(), { cleared: true });
    assert.deepEqual(await storage.list(context), []);
    assert.equal(
      (
        await f.db.query(
          "SELECT * FROM assistant_turns WHERE conversation_id IN ($1,$2)",
          [old.id, recent.id],
        )
      ).rowCount,
      0,
    );
    for (const saved of [otherCard, product, general])
      assert.equal((await storage.get(saved.id)).id, saved.id);
    assert.equal(
      (
        await f.app.inject({
          url: `/api/assistant/conversations/${old.id}`,
          headers,
        })
      ).statusCode,
      404,
    );
    await f.reopen();
    const nextHeaders = await loginHeaders(f.app);
    const restored = new AssistantConversations(f.db);
    assert.deepEqual(await restored.list(context), []);
    assert.equal((await restored.get(otherCard.id)).id, otherCard.id);
    let input: any[] = [];
    globalThis.fetch = async (_url, options) => {
      input = JSON.parse(options?.body as string).input;
      return Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "新的回答" }],
          },
        ],
      });
    };
    const next = await f.app.inject({
      method: "POST",
      url: "/api/assistant/chat",
      headers: nextHeaders,
      payload: { ...context, message: "清空后的新问题" },
    });
    assert.equal(next.statusCode, 200);
    assert.equal(next.json().conversation.turns.length, 1);
    assert.equal(input.at(-1).content[0].text, "清空后的新问题");
    assert.doesNotMatch(
      JSON.stringify(input),
      /清空前的旧问题|清空前的旧回答|进行中的问题|部分回复/,
    );
  } finally {
    globalThis.fetch = original;
    await f.close();
  }
});

test("clearing product or general consultation keeps nested card histories", async () => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app);
    const storage = new AssistantConversations(f.db);
    const productContext = { productId: f.product.id };
    const product = await storage.create(productContext);
    const general = await storage.create({});
    const card = await storage.create({
      ...productContext,
      taskId: f.product.tasks[0].id,
    });
    for (const context of [productContext, {}]) {
      assert.equal(
        (
          await f.app.inject({
            method: "POST",
            url: "/api/assistant/conversations/clear",
            headers,
            payload: context,
          })
        ).statusCode,
        200,
      );
      assert.equal((await storage.get(card.id)).id, card.id);
      if ("productId" in context)
        assert.equal((await storage.get(general.id)).id, general.id);
    }
    assert.equal(
      (
        await f.db.query(
          "SELECT * FROM assistant_conversations WHERE id IN ($1,$2)",
          [product.id, general.id],
        )
      ).rowCount,
      0,
    );
  } finally {
    await f.close();
  }
});
