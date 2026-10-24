import test from "node:test";
import assert from "node:assert/strict";
import {
  fixture,
  loginHeaders,
  png,
  fakeProvider,
  counts,
} from "../../support/production.js";
import { Accounts } from "../../../server/production/accounts.js";
import { Members } from "../../../server/production/members.js";
import { Provisioning } from "../../../server/production/provisioning.js";
import { AssistantConversations } from "../../../server/production/assistant-conversations.js";
import { Worker } from "../../../server/production/worker.js";
import { assertImageQuota } from "../../../server/production/account-usage.js";
import { newProduct } from "../../../shared/model.js";
import { editable, differences } from "../../../shared/workspace-edits.js";
import type { Product } from "../../../server/production/types.js";
import sharp from "sharp";

const teamPassword = "team-b-password-123";
async function teams() {
  const f = await fixture();
  const accounts = new Accounts(f.db);
  const team = await new Provisioning(f.db).provisionTeam({
    username: "team_b",
    password: teamPassword,
    workspaceName: "B团队",
  });
  const a = await loginHeaders(f.app);
  const login = await f.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "team_b", password: teamPassword },
  });
  assert.equal(login.statusCode, 200, login.body);
  assert.equal(login.json().user.workspaceId, team.workspaceId);
  assert.equal(login.json().user.workspaceName, "B团队");
  const b = { cookie: String(login.headers["set-cookie"]).split(";")[0] };
  const workflowsB = await f.workspaces.get(team.workspaceId);
  return { f, accounts, team, a, b, workflowsB };
}
async function seedB(t: Awaited<ReturnType<typeof teams>>) {
  const state = await t.workflowsB.repo.view(),
    after = structuredClone(state);
  const product = newProduct("TEST-01", "B团队产品", "仅 B 可见") as Product;
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 4, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  const image = `data:image/png;base64,${bytes.toString("base64")}`;
  product.photo = image;
  product.photos = [image];
  for (const task of product.tasks) task.references = [image];
  after.products.push(product);
  await t.workflowsB.edit(differences(editable(state), editable(after)));
  await t.workflowsB.updateSettings({
    apiKey: "team-b-image-key",
    promptApiKey: "team-b-chat-key",
  });
  return (await t.workflowsB.repo.view()).products[0];
}

test("provisioning an owner creates an empty independent team and scoped member administration", async () => {
  const t = await teams(),
    { f, a, b, team, accounts } = t;
  try {
    const empty = (
      await f.app.inject({ url: "/api/workspace", headers: b })
    ).json();
    assert.deepEqual(empty.products, []);
    assert.deepEqual(empty.jobs, []);
    const settings = (
      await f.app.inject({ url: "/api/workflow/settings", headers: b })
    ).json();
    assert.equal(settings.hasKey, false);
    assert.equal(settings.hasPromptKey, false);
    const create = await f.app.inject({
      method: "POST",
      url: "/api/members",
      headers: b,
      payload: {
        username: "b_editor",
        displayName: "B成员",
        role: "editor",
        monthlyLimit: 1,
      },
    });
    assert.equal(create.statusCode, 200, create.body);
    const { id, token } = create.json();
    const listA = (
      await f.app.inject({ url: "/api/members", headers: a })
    ).json().members;
    const listB = (
      await f.app.inject({ url: "/api/members", headers: b })
    ).json().members;
    assert.deepEqual(
      listA.map((u: any) => u.username),
      ["admin"],
    );
    assert.deepEqual(
      new Set(listB.map((u: any) => u.username)),
      new Set(["team_b", "b_editor"]),
    );
    for (const [method, url, payload] of [
      [
        "PATCH",
        `/api/members/${id}`,
        {
          displayName: "越权",
          role: "viewer",
          enabled: false,
          monthlyLimit: 0,
        },
      ],
      ["POST", `/api/members/${id}/invitation`, {}],
      ["DELETE", `/api/members/${id}`, undefined],
      [
        "PATCH",
        `/api/members/${team.id}`,
        {
          displayName: "越权",
          role: "viewer",
          enabled: false,
          monthlyLimit: 0,
        },
      ],
    ] as const)
      assert.equal(
        (await f.app.inject({ method, url, payload, headers: a })).statusCode,
        404,
      );
    const activated = await f.app.inject({
      method: "POST",
      url: "/api/auth/accept-invitation",
      payload: { token, password: "b-member-password" },
    });
    assert.equal(activated.json().user.workspaceId, team.workspaceId);
    assert.equal(
      (await new Members(f.db, team.workspaceId).list()).find(
        (u) => u.id === id,
      )?.status,
      "active",
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/teams",
          payload: {},
          headers: b,
        })
      ).statusCode,
      404,
    );
    await assert.rejects(
      new Provisioning(f.db).provisionTeam({
        username: "team_b",
        password: teamPassword,
        workspaceName: "重复",
      }),
      /用户名已使用/,
    );
    assert.equal((await new Provisioning(f.db).teamOwners()).length, 2);
    await f.reopen();
    assert.deepEqual(
      (await f.app.inject({ url: "/api/workspace", headers: b })).json()
        .products,
      [],
    );
    await new Accounts(f.db).resetPassword("team_b", "changed-team-password");
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers: b })).statusCode,
      401,
    );
  } finally {
    await f.close();
  }
});

test("products, credentials, images, thumbnails and incremental tombstones cannot cross team boundaries", async () => {
  const t = await teams(),
    { f, a, b, team, workflowsB } = t;
  try {
    const productB = await seedB(t),
      productA = (await f.workflows.repo.view()).products[0];
    assert.notEqual(
      await f.workflows.assets.normalize(png),
      await workflowsB.assets.normalize(png),
      "identical image bytes use team-specific asset IDs",
    );
    for (const [headers, forbidden] of [
      [a, productB.photo],
      [b, productA.photo],
    ] as const) {
      assert.equal(
        (await f.app.inject({ url: forbidden, headers })).statusCode,
        404,
      );
      assert.equal(
        (await f.app.inject({ url: `${forbidden}/thumbnail`, headers }))
          .statusCode,
        404,
      );
    }
    assert.equal(
      (await f.app.inject({ url: productB.photo, headers: b })).statusCode,
      200,
    );
    const ownThumbnail = await f.app.inject({
      url: `${productB.photo}/thumbnail`,
      headers: b,
    });
    assert.equal(ownThumbnail.statusCode, 200);
    assert.match(String(ownThumbnail.headers["cache-control"]), /no-store/);
    const foreignImageEdit = await f.app.inject({
      method: "PATCH",
      url: "/api/workspace",
      headers: b,
      payload: {
        edits: [
          {
            path: ["products", productB.id, "photo"],
            before: productB.photo,
            value: productA.photo,
          },
        ],
      },
    });
    assert.equal(foreignImageEdit.statusCode, 404);
    const colliding = structuredClone(productB);
    colliding.id = productA.id;
    colliding.code = "COLLISION";
    const collision = await f.app.inject({
      method: "PATCH",
      url: "/api/workspace",
      headers: b,
      payload: {
        edits: [
          {
            path: ["products", productA.id],
            before: null,
            value: editable({ products: [colliding] } as any).products[
              productA.id
            ],
          },
        ],
      },
    });
    assert.equal(collision.statusCode, 409, collision.body);
    assert.equal(
      (await f.workflows.repo.view()).products[0].name,
      productA.name,
    );
    await workflowsB.updateSettings({ promptModel: "b-only-model" });
    assert.notEqual((await f.workflows.settings()).promptModel, "b-only-model");
    assert.equal(await workflowsB.key("image"), "team-b-image-key");
    for (const url of ["/api/auth/logout", "/api/auth/password"]) {
      assert.equal(
        (
          await f.app.inject({
            method: "POST",
            url,
            headers: {
              ...b,
              "x-workspace-id": "default",
              "x-account-id": "owner",
            },
            payload: {
              currentPassword: teamPassword,
              password: "should-not-change-password",
            },
          })
        ).statusCode,
        401,
      );
    }
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers: b })).statusCode,
      200,
    );
    assert.equal(await f.workflows.key("image"), "fake-platform-key");
    const cursorB = await workflowsB.repo.cursor();
    const temporary = newProduct("A-TEMP", "A删除记录", "A私密资料") as Product;
    await f.workflows.repo.saveProduct(f.db, temporary);
    await f.db.query("DELETE FROM products WHERE id=$1", [temporary.id]);
    assert.equal(await workflowsB.repo.cursor(), cursorB);
    const delta = (
      await f.app.inject({ url: "/api/workspace/changes?since=0", headers: b })
    ).json();
    assert.deepEqual(
      delta.products.map((p: any) => p.id),
      [productB.id],
    );
    assert.ok(!JSON.stringify(delta).includes(temporary.id));
    assert.equal(
      (
        await f.app.inject({
          url: "/api/workspace",
          headers: { ...a, "x-workspace-id": team.workspaceId },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/workflow/settings",
          headers: { ...b, "x-workspace-id": "default" },
          payload: { clearKey: true },
        })
      ).statusCode,
      403,
    );
    assert.equal(await workflowsB.key("image"), "team-b-image-key");
  } finally {
    await f.close();
  }
});

test("same command IDs, queue controls, worker recovery and quotas are scoped to each team", async () => {
  const t = await teams(),
    { f, a, b, team, workflowsB } = t;
  try {
    const productB = await seedB(t),
      productA = f.product;
    for (const [headers, product] of [
      [a, productA],
      [b, productB],
    ] as const) {
      const response = await f.app.inject({
        method: "POST",
        url: "/api/jobs",
        headers,
        payload: {
          commandId: "same-id",
          kind: "prompt",
          pairs: [{ productId: product.id, taskId: product.tasks[0].id }],
        },
      });
      assert.equal(response.statusCode, 200, response.body);
    }
    const jobA = (await f.workflows.repo.view()).jobs[0],
      jobB = (await workflowsB.repo.view()).jobs[0];
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `/api/jobs/${jobA.id}/control`,
          headers: b,
          payload: { commandId: "cannot-cancel", action: "cancel" },
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/jobs",
          headers: b,
          payload: {
            commandId: "foreign-product",
            kind: "prompt",
            pairs: [{ productId: productA.id, taskId: productA.tasks[0].id }],
          },
        })
      ).statusCode,
      400,
    );
    const historyB = (
      await f.app.inject({ url: "/api/jobs/history", headers: b })
    ).json();
    assert.deepEqual(
      historyB.jobs.map((j: any) => j.id),
      [jobB.id],
    );
    await f.workflows.control("queue", "pause", {
      commandId: "pause-a",
      paused: true,
    });
    const aCalls = counts(),
      bCalls = counts();
    assert.equal(
      await new Worker(f.workflows, fakeProvider(aCalls), () => {}).step(),
      false,
    );
    assert.equal(
      await new Worker(workflowsB, fakeProvider(bCalls), () => {}).step(),
      true,
    );
    assert.equal(aCalls.analyze, 0);
    assert.equal(bCalls.analyze, 1);
    assert.equal((await workflowsB.repo.view()).jobs[0].status, "completed");
    assert.equal((await f.workflows.repo.view()).jobs[0].status, "queued");
    await f.db.query(
      "UPDATE jobs SET status='running',lease_until=0 WHERE id=$1",
      [jobA.id],
    );
    await workflowsB.repo.claim("b-worker");
    assert.equal((await f.workflows.repo.view()).jobs[0].status, "running");
    await assert.rejects(
      f.db.transaction((tx) => assertImageQuota(tx, "owner", team.workspaceId)),
      /不能发起任务/,
    );
    assert.equal((await new Members(f.db).list())[0].used, 0);
    assert.equal((await new Members(f.db, team.workspaceId).list())[0].used, 0);
    await f.reopen();
    assert.deepEqual(
      (await f.app.inject({ url: "/api/jobs/history", headers: b }))
        .json()
        .jobs.map((j: any) => j.id),
      [jobB.id],
    );
  } finally {
    await f.close();
  }
});

test("conversations and live analysis streams are isolated even when IDs are supplied directly", async () => {
  const t = await teams(),
    { f, a, b, team, workflowsB } = t;
  try {
    await seedB(t);
    const conversationsA = new AssistantConversations(f.db),
      conversationsB = new AssistantConversations(f.db, team.workspaceId);
    const ca = await conversationsA.create({}),
      cb = await conversationsB.create({});
    await conversationsA.start(
      ca.id,
      "private-a-turn",
      "A团队私密问题",
      "fake-model",
    );
    await conversationsA.finish(
      ca.id,
      "private-a-turn",
      "completed",
      "A团队私密回答",
    );
    assert.equal(
      (
        await f.app.inject({
          url: `/api/assistant/conversations/${ca.id}`,
          headers: b,
        })
      ).statusCode,
      404,
    );
    for (const action of ["select", "turns/private-a-turn/cancel"])
      assert.equal(
        (
          await f.app.inject({
            method: "POST",
            url: `/api/assistant/conversations/${ca.id}/${action}`,
            headers: b,
          })
        ).statusCode,
        404,
      );
    const listB = (
      await f.app.inject({ url: "/api/assistant/conversations", headers: b })
    ).json();
    assert.deepEqual(
      listB.conversations.map((c: any) => c.id),
      [cb.id],
    );
    await f.app.inject({
      method: "POST",
      url: "/api/assistant/conversations/clear",
      headers: b,
      payload: {},
    });
    assert.equal(
      (await conversationsA.get(ca.id)).turns[0].assistantText,
      "A团队私密回答",
    );
    await f.app.listen({ host: "127.0.0.1", port: 0 });
    const origin = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
    const abort = new AbortController();
    const response = await fetch(
      `${origin}/api/analysis/events?workspace=${team.workspaceId}`,
      { headers: b, signal: abort.signal },
    );
    const reader = response.body!.getReader();
    await reader.read();
    f.workflows.analysisEvents.publish({
      id: "private-a-job",
      drafts: { secret: "A私密输出" },
    } as any);
    workflowsB.analysisEvents.publish({
      id: "private-b-job",
      drafts: { own: "B团队输出" },
    } as any);
    const next = await reader.read();
    const text = new TextDecoder().decode(next.value);
    assert.match(text, /private-b-job/);
    assert.ok(!text.includes("A私密输出"));
    abort.abort();
    await reader.cancel().catch(() => {});
  } finally {
    await f.close();
  }
});
