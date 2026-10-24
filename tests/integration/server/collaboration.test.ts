import test from "node:test";
import assert from "node:assert/strict";
import { fixture, loginHeaders, password } from "../../support/production.js";
import { Members } from "../../../server/production/members.js";
import { editable, differences } from "../../../shared/workspace-edits.js";
import { workflowSnapshot } from "../../../src/integrations/sheet-bridge.js";
import { WorkspaceClient } from "../../../src/services/workspace-client.js";

test("activity returns only the latest 100 records while retaining older history", async () => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app);
    const ids: number[] = [];
    await f.db.transaction(async (tx) => {
      for (let index = 0; index < 105; index++) {
        const result = await tx.query(
          "INSERT INTO workspace_activity(workspace_id,created_at,payload) VALUES($1,$2,$3) RETURNING id",
          [
            "default",
            Date.now(),
            {
              actor: { displayName: "记录测试", username: "admin" },
              changes: [
                {
                  path: ["products", f.product.id, "facts"],
                  before: String(index),
                  value: String(index + 1),
                },
              ],
            },
          ],
        );
        ids.push(result.rows[0].id);
      }
    });
    const response = await f.app.inject({
      url: "/api/workspace/activity",
      headers,
    });
    assert.equal(response.statusCode, 200);
    const history = response.json();
    assert.deepEqual(
      history.items.map((item: any) => item.id),
      ids.slice(-100).reverse(),
    );
    assert.equal(history.next, null);
    assert.equal(
      (
        await f.db.query(
          "SELECT COUNT(*) AS count FROM workspace_activity WHERE id=$1",
          [ids[0]],
        )
      ).rows[0].count,
      1,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/workspace/activity" })).statusCode,
      401,
    );
  } finally {
    await f.close();
  }
});

test("latest field and cell saves retain unrelated changes and record actual previous values with trusted authors", async () => {
  const f = await fixture();
  try {
    const owner = await loginHeaders(f.app);
    await new Members(f.db).create({
      username: "activity-editor",
      displayName: "协作者",
      password,
      role: "editor",
      monthlyLimit: null,
    });
    const login = await f.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "activity-editor", password },
    });
    const editor = {
      cookie: String(login.headers["set-cookie"]).split(";")[0],
    };
    const base = await f.workflows.repo.view();
    const a = structuredClone(base),
      b = structuredClone(base);
    a.products[0].facts = "A保存的资料";
    b.products[0].name = "B保存的名称";
    const patch = (headers: any, edits: any[]) =>
      f.app.inject({
        method: "PATCH",
        url: "/api/workspace",
        headers,
        payload: { edits },
      });
    assert.equal(
      (await patch(owner, differences(editable(base), editable(a)))).statusCode,
      200,
    );
    assert.equal(
      (await patch(editor, differences(editable(base), editable(b))))
        .statusCode,
      200,
    );
    const staleEdit = {
      path: ["products", f.product.id, "facts"],
      before: base.products[0].facts,
      value: "B最后保存的资料",
    };
    assert.equal((await patch(editor, [staleEdit])).statusCode, 200);
    const current = await f.workflows.repo.view();
    assert.equal(current.products[0].name, "B保存的名称");
    assert.equal(current.products[0].facts, staleEdit.value);
    const history = (
      await f.app.inject({ url: "/api/workspace/activity", headers: owner })
    ).json();
    const record = history.items.find((item: any) =>
      item.changes.some((c: any) => c.value === staleEdit.value),
    );
    assert.equal(record.actor.displayName, "协作者");
    assert.equal(record.changes[0].before, "A保存的资料");
    const first = history.items[0].id;
    await patch(editor, [staleEdit]);
    assert.equal(
      (
        await f.app.inject({ url: "/api/workspace/activity", headers: owner })
      ).json().items[0].id,
      first,
      "unchanged retries do not create history entries",
    );

    await f.workflows.edit([
      {
        path: ["sheetSnapshot"],
        before: null,
        value: workflowSnapshot(current),
      },
    ]);
    const initial = await f.workflows.repo.view();
    const initialSheet = initial.sheetSnapshot;
    const left = structuredClone(initialSheet),
      right = structuredClone(initialSheet);
    left.sheets.preview.cellData[2][4] = { v: "左边单元格" };
    right.sheets.preview.cellData[2][5] = { v: "右边单元格" };
    // Older bundles still send a whole snapshot; the server expands their edit.
    await patch(owner, [
      { path: ["sheetSnapshot"], before: initialSheet, value: left },
    ]);
    await patch(editor, [
      { path: ["sheetSnapshot"], before: initialSheet, value: right },
    ]);
    const saved = (await f.workflows.repo.view()).sheetSnapshot;
    assert.equal(saved.sheets.preview.cellData[2][4].v, "左边单元格");
    assert.equal(saved.sheets.preview.cellData[2][5].v, "右边单元格");
    await patch(editor, [
      {
        path: ["sheetSnapshot", "sheets", "preview", "cellData", "2", "4"],
        before: initialSheet.sheets.preview.cellData[2][4],
        value: {
          ...initialSheet.sheets.preview.cellData[2][4],
          s: { cl: { rgb: "#245edb" } },
        },
      },
    ]);
    assert.equal(
      (await f.workflows.repo.view()).sheetSnapshot.sheets.preview
        .cellData[2][4].v,
      "左边单元格",
      "stale formatting cannot replay an old empty cell",
    );
    assert.equal(
      (
        await patch(editor, [
          {
            path: ["sheetSnapshot", "sheets", "preview", "cellData", "2", "4"],
            before: null,
            value: { v: "最后提交" },
          },
        ])
      ).statusCode,
      200,
    );
    assert.equal(
      (await f.workflows.repo.view()).sheetSnapshot.sheets.preview
        .cellData[2][4].v,
      "最后提交",
    );
    const sheetHistory = (
      await f.app.inject({ url: "/api/workspace/activity", headers: owner })
    ).json();
    assert.equal(sheetHistory.items[0].changes[0].before.v, "左边单元格");
    assert.equal(
      (
        await patch(owner, [
          {
            path: ["sheetSnapshot", "__proto__", "polluted"],
            before: null,
            value: true,
          },
        ])
      ).statusCode,
      400,
    );
    assert.equal(({} as any).polluted, undefined);
    await f.reopen();
    assert.ok(
      (
        await f.app.inject({ url: "/api/workspace/activity", headers: owner })
      ).json().items.length > 0,
    );
  } finally {
    await f.close();
  }
});

test("presence is scoped, authenticated, transient and expires; event streams push committed changes", async () => {
  const f = await fixture();
  const abort = new AbortController();
  try {
    const headers = await loginHeaders(f.app);
    const selection = {
      sheetId: "preview",
      startRow: 2,
      endRow: 2,
      startColumn: 4,
      endColumn: 4,
    };
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/workspace/presence",
          headers,
          payload: { session: "presence-session-one", selection },
        })
      ).statusCode,
      200,
    );
    const peer = f.workflows.collaboration.snapshot()[0];
    assert.equal(peer.actor.username, "admin");
    await f.app.inject({
      method: "POST",
      url: "/api/workspace/presence",
      headers,
      payload: {
        session: "presence-session-one",
        selection,
        actor: { username: "fake" },
      },
    });
    assert.equal(
      f.workflows.collaboration.snapshot()[0].actor.username,
      "admin",
    );
    f.workflows.collaboration.snapshot()[0].updatedAt = Date.now() - 31000;
    peer.updatedAt = Date.now() - 31000;
    assert.deepEqual(f.workflows.collaboration.snapshot(), []);
    await f.app.listen({ host: "127.0.0.1", port: 0 });
    const root = `http://127.0.0.1:${(f.app.server.address() as any).port}`;
    const response = await fetch(
      `${root}/api/workspace/events?workspace=default&session=presence-session-one`,
      { headers, signal: abort.signal },
    );
    const reader = response.body!.getReader();
    await reader.read();
    const state = await f.workflows.repo.view();
    await f.workflows.edit([
      {
        path: ["products", f.product.id, "facts"],
        before: state.products[0].facts,
        value: "推送修改",
      },
    ]);
    const next = await reader.read();
    assert.match(new TextDecoder().decode(next.value), /changed/);
    abort.abort();
    await reader.cancel().catch(() => {});
  } finally {
    abort.abort();
    await f.close();
  }
});
