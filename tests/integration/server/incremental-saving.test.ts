import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  fixture,
  loginHeaders,
  pairs,
  counts,
  fakeProvider,
} from "../../support/production.js";
import { newProduct } from "../../../shared/model.js";
import { Worker } from "../../../server/production/worker.js";
import { WorkspaceClient } from "../../../src/services/workspace-client.js";
import type { Queryable } from "../../../server/production/types.js";

const patch = (
  f: Awaited<ReturnType<typeof fixture>>,
  headers: any,
  edits: any[],
) =>
  f.app.inject({
    method: "PATCH",
    url: "/api/workspace",
    headers: { ...headers, "x-workspace-result": "delta" },
    payload: { edits },
  });

test("delta saves read only named products, preserve sheets and never read jobs or rewrite unrelated records", async (t) => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app);
    const other = newProduct("UNTOUCHED");
    const sheet = {
      sheets: { preview: { cellData: { 2: { 4: { v: "retained" } } } } },
    };
    await f.db.transaction(async (tx) => {
      await f.workflows.repo.saveProduct(tx, other);
      await f.workflows.repo.saveWorkspaceFields(tx, { sheetSnapshot: sheet });
    });
    const sql: string[] = [];
    const transaction = f.db.transaction.bind(f.db);
    t.mock.method(
      f.db,
      "transaction",
      (work: (tx: Queryable) => Promise<unknown>) =>
        transaction((tx) =>
          work({
            query: (query, values) => {
              sql.push(query);
              return tx.query(query, values);
            },
          }),
        ),
    );
    t.mock.method(f.workflows.repo, "view", async () => {
      throw Error("full read is forbidden");
    });
    const edit = {
      path: ["products", f.product.id, "name"],
      before: f.product.name,
      value: "changed",
    };
    const response = await patch(f, headers, [edit]);
    assert.equal(response.statusCode, 200, response.body);
    const result = response.json();
    assert.equal(result.editResult, "delta");
    assert.deepEqual(
      result.products.map((p: any) => p.id),
      [f.product.id],
    );
    assert.equal(result.products[0].name, "changed");
    assert.deepEqual(result.document, {});
    assert.equal(typeof result.cursor, "number");
    assert.equal(result.jobs, undefined);
    assert.ok(sql.every((query) => !/\bjobs\b/.test(query)));
    assert.equal(
      sql.filter((query) => /INSERT INTO products/.test(query)).length,
      1,
    );
    assert.equal(
      sql.filter((query) => /UPDATE workspace SET/.test(query)).length,
      0,
    );
    assert.ok(
      sql.some((query) =>
        query.includes("json_remove(document,'$.sheetSnapshot')"),
      ),
    );
    assert.deepEqual(
      (
        await f.db.query("SELECT document FROM products WHERE id=$1", [
          other.id,
        ])
      ).rows[0].document,
      other,
    );
    assert.deepEqual(
      (await f.db.query("SELECT document FROM workspace WHERE id='default'"))
        .rows[0].document.sheetSnapshot,
      sheet,
    );

    sql.length = 0;
    const repeated = await patch(f, headers, [edit]);
    assert.equal(repeated.statusCode, 200);
    assert.equal(repeated.json().products[0].name, "changed");
    assert.ok(
      sql.every(
        (query) =>
          !/INSERT INTO (products|workspace_activity)|UPDATE workspace SET/.test(
            query,
          ),
      ),
    );

    sql.length = 0;
    const common = await patch(f, headers, [
      { path: ["common"], before: "stale", value: "new common rules" },
    ]);
    assert.equal(common.statusCode, 200, common.body);
    assert.deepEqual(common.json().products, []);
    assert.deepEqual(common.json().document, { common: "new common rules" });
    assert.ok(sql.every((query) => !/FROM products|\bjobs\b/.test(query)));
    assert.deepEqual(
      (await f.db.query("SELECT document FROM workspace WHERE id='default'"))
        .rows[0].document.sheetSnapshot,
      sheet,
    );
  } finally {
    await f.close();
  }
});

test("scoped saves check product codes outside their patch and roll back invalid batches", async () => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app);
    const other = newProduct("TAKEN");
    await f.db.transaction((tx) => f.workflows.repo.saveProduct(tx, other));
    const response = await patch(f, headers, [
      {
        path: ["products", f.product.id, "name"],
        before: f.product.name,
        value: "must roll back",
      },
      {
        path: ["products", f.product.id, "code"],
        before: f.product.code,
        value: other.code,
      },
    ]);
    assert.equal(response.statusCode, 400, response.body);
    assert.match(response.json().error, /产品编号重复/);
    assert.equal(
      (await f.workflows.repo.view()).products.find(
        (p) => p.id === f.product.id,
      )?.name,
      f.product.name,
    );
    const stale = await patch(f, headers, [
      {
        path: ["products", "deleted-product", "name"],
        before: "old",
        value: "new",
      },
    ]);
    assert.equal(stale.statusCode, 409);
    const forbidden = await patch(f, headers, [
      {
        path: [
          "products",
          f.product.id,
          "tasks",
          f.product.tasks[0].id,
          "versions",
        ],
        before: [],
        value: [],
      },
    ]);
    assert.equal(forbidden.statusCode, 400);
  } finally {
    await f.close();
  }
});

test("15 concurrent delta saves retain separate fields, saved order and actual audit before-values", async () => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app);
    const products = [
      f.product,
      ...Array.from({ length: 14 }, (_, i) => newProduct(`CONCURRENT-${i}`)),
    ];
    await f.db.transaction(async (tx) => {
      for (const product of products.slice(1))
        await f.workflows.repo.saveProduct(tx, product);
    });
    const results = await Promise.all(
      products.map((product, i) =>
        patch(f, headers, [
          {
            path: ["products", product.id, "name"],
            before: product.name,
            value: `Saved ${i}`,
          },
        ]),
      ),
    );
    assert.ok(results.every((r) => r.statusCode === 200));
    await Promise.all([
      patch(f, headers, [
        {
          path: ["products", f.product.id, "facts"],
          before: f.product.facts,
          value: "concurrent facts",
        },
      ]),
      patch(f, headers, [
        {
          path: ["products", f.product.id, "name"],
          before: f.product.name,
          value: "last name",
        },
      ]),
    ]);
    const state = await f.workflows.repo.view();
    assert.equal(state.products.length, 15);
    const product = state.products.find((p) => p.id === f.product.id)!;
    assert.equal(product.name, "last name");
    assert.equal(product.facts, "concurrent facts");
    const history = (
      await f.app.inject({ url: "/api/workspace/activity", headers })
    ).json();
    const change = history.items
      .flatMap((item: any) => item.changes)
      .find((item: any) => item.value === "last name");
    assert.equal(change.before, "Saved 0");
  } finally {
    await f.close();
  }
});

test("delta saves and background image completion preserve each other's changes and history", async () => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app);
    await f.workflows.edit([
      {
        path: [
          "products",
          f.product.id,
          "tasks",
          f.product.tasks[0].id,
          "prompt",
        ],
        before: "",
        value: "ready",
      },
    ]);
    const provider = fakeProvider(counts());
    const worker = new Worker(f.workflows, provider);
    await f.workflows.enqueue(
      randomUUID(),
      pairs(f.product).slice(0, 1),
      "image",
    );
    await worker.step();
    await f.due();
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const query = provider.query;
    provider.query = async (...args) => {
      entered();
      await gate;
      return query(...args);
    };
    const completion = worker.step();
    try {
      await ready;
      assert.equal(
        (
          await patch(f, headers, [
            {
              path: ["products", f.product.id, "facts"],
              before: f.product.facts,
              value: "edited during generation",
            },
          ])
        ).statusCode,
        200,
      );
    } finally {
      release();
      await completion;
    }
    const saved = await patch(f, headers, [
      {
        path: ["products", f.product.id, "name"],
        before: f.product.name,
        value: "edited after generation",
      },
    ]);
    assert.equal(saved.statusCode, 200, saved.body);
    const product = saved.json().products[0];
    assert.equal(product.facts, "edited during generation");
    assert.equal(product.name, "edited after generation");
    assert.equal(product.tasks[0].versions.length, 1);
    assert.equal(product.tasks[0].primaryId, product.tasks[0].versions[0].id);
    assert.equal((await f.workflows.repo.view()).jobs[0].status, "completed");
  } finally {
    await f.close();
  }
});

test("a save acknowledgement cannot advance sync past another editor's changes or erase in-flight drafts", async (t) => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app);
    const other = newProduct("OTHER");
    await f.db.transaction((tx) => f.workflows.repo.saveProduct(tx, other));
    const state = (
      await f.app.inject({ url: "/api/workspace", headers })
    ).json();
    const originalCursor = state.syncCursor;
    const client = new WorkspaceClient(state, {
      render() {},
      sync() {},
      notify() {},
    });
    await patch(f, headers, [
      {
        path: ["products", other.id, "facts"],
        before: other.facts,
        value: "other editor's change",
      },
    ]);
    let injectDraft = true;
    t.mock.method(
      globalThis,
      "fetch",
      async (url: string, options: any = {}) => {
        const response = await f.app.inject({
          url,
          method: options.method || "GET",
          headers: { ...headers, ...options.headers },
          payload: options.body,
        });
        if (options.method === "PATCH" && injectDraft) {
          assert.equal(options.headers["x-workspace-result"], "delta");
          state.products.find((p: any) => p.id === f.product.id).facts =
            "typed while saving";
          injectDraft = false;
        }
        return new Response(response.body, { status: response.statusCode });
      },
    );
    state.products.find((p: any) => p.id === f.product.id).name =
      "my saved name";
    await client.save();
    assert.equal(client.cursor, originalCursor);
    assert.equal(
      state.products.find((p: any) => p.id === f.product.id).facts,
      "typed while saving",
    );
    await client.refresh();
    assert.equal(
      state.products.find((p: any) => p.id === other.id).facts,
      "other editor's change",
    );
    assert.equal(
      state.products.find((p: any) => p.id === f.product.id).facts,
      "typed while saving",
    );
    assert.ok(client.cursor > originalCursor);
    await client.save();
    assert.equal(
      (await f.workflows.repo.view()).products.find(
        (p) => p.id === f.product.id,
      )?.facts,
      "typed while saving",
    );
  } finally {
    await f.close();
  }
});

test("an already applied save acknowledges current product and workspace values instead of restoring an older baseline", async (t) => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app);
    const state = (
      await f.app.inject({ url: "/api/workspace", headers })
    ).json();
    const client = new WorkspaceClient(state, {
      render() {},
      sync() {},
      notify() {},
    });
    await patch(f, headers, [
      {
        path: ["products", f.product.id, "name"],
        before: f.product.name,
        value: "same saved name",
      },
      { path: ["common"], before: state.common, value: "same saved rules" },
    ]);
    t.mock.method(
      globalThis,
      "fetch",
      async (url: string, options: any = {}) => {
        const response = await f.app.inject({
          url,
          method: options.method || "GET",
          headers: { ...headers, ...options.headers },
          payload: options.body,
        });
        return new Response(response.body, { status: response.statusCode });
      },
    );
    state.products[0].name = "same saved name";
    state.common = "same saved rules";
    await client.save();
    assert.equal(state.products[0].name, "same saved name");
    assert.equal(client.baseline.products[0].name, "same saved name");
    assert.equal(state.common, "same saved rules");
    assert.equal(client.baseline.common, "same saved rules");
  } finally {
    await f.close();
  }
});

test("delta sheet saves merge stale cells while legacy saves retain the full response", async () => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app);
    const sheet = {
      sheets: {
        preview: { cellData: { 2: { 4: { v: "start" }, 5: { v: "keep" } } } },
      },
    };
    await patch(f, headers, [
      { path: ["sheetSnapshot"], before: null, value: sheet },
    ]);
    await patch(f, headers, [
      {
        path: ["sheetSnapshot", "sheets", "preview", "cellData", "2", "4"],
        before: { v: "start" },
        value: { v: "new text" },
      },
    ]);
    const result = await patch(f, headers, [
      {
        path: ["sheetSnapshot", "sheets", "preview", "cellData", "2", "4"],
        before: { v: "start" },
        value: { v: "start", s: "format" },
      },
    ]);
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(
      result.json().document.sheetSnapshot.sheets.preview.cellData[2][4].v,
      "new text",
    );
    assert.equal(
      result.json().document.sheetSnapshot.sheets.preview.cellData[2][5].v,
      "keep",
    );
    const legacy = await f.app.inject({
      method: "PATCH",
      url: "/api/workspace",
      headers,
      payload: {
        edits: [
          {
            path: ["products", f.product.id, "name"],
            before: f.product.name,
            value: "legacy",
          },
        ],
      },
    });
    assert.equal(legacy.statusCode, 200, legacy.body);
    assert.equal(legacy.json().schema, 2);
    assert.ok(Array.isArray(legacy.json().jobs));
    assert.equal(
      legacy.json().sheetSnapshot.sheets.preview.cellData[2][4].v,
      "new text",
    );
  } finally {
    await f.close();
  }
});
