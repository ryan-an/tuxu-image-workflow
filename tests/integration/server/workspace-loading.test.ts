import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { fixture, loginHeaders, pairs } from "../../support/production.js";
import { newProduct } from "../../../shared/model.js";
import { workflowSnapshot } from "../../../src/integrations/sheet-bridge.js";
import { WorkspaceClient } from "../../../src/services/workspace-client.js";
import { editable, differences } from "../../../shared/workspace-edits.js";

test("startup omits product details, sheets and old execution snapshots; edits and deltas retain the compact scope", async () => {
  const f = await fixture();
  try {
    await f.workflows.enqueue(randomUUID(), pairs(f.product), "prompt-set");
    await f.db.transaction(async (tx) => {
      const state = await f.workflows.repo.view(tx);
      const original = state.jobs[0];
      original.status = "completed";
      await f.workflows.repo.saveJob(tx, original);
      const products = [];
      for (let index = 0; index < 24; index++) {
        const product =
          index === 0 ? state.products[0] : newProduct(`PRODUCT-${index}`);
        for (const task of product.tasks) {
          task.prompt = `prompt-${index}:` + "long saved prompt ".repeat(120);
          task.promptHistory = Array.from({ length: 4 }, () => ({
            prompt: "old prompt ".repeat(120),
            createdAt: 1,
          }));
        }
        product.promptSets = [
          { id: "old-suite", response: "old suite response ".repeat(500) },
        ];
        await f.workflows.repo.saveProduct(tx, product);
        products.push(product);
      }
      for (let index = 0; index < 180; index++)
        await f.workflows.repo.insertJob(tx, {
          ...original,
          id: `history-${index}`,
          createdAt: original.createdAt + index + 1,
          analysisResponse: "large provider response ".repeat(500),
          ...(index === 179
            ? {
                status: "failed",
                promptDrafts: {
                  尺寸图: "recoverable partial analysis ".repeat(100),
                },
              }
            : {}),
        });
      state.products = products;
      state.sheetSnapshot = workflowSnapshot(state);
      await f.workflows.repo.saveWorkspace(tx, state);
    });
    const headers = await loginHeaders(f.app);
    const read = (url: string, extra = {}) =>
      f.app.inject({ url, headers: { ...headers, ...extra } });
    const full = await read("/api/workspace");
    const startup = await read("/api/workspace/startup");
    assert.equal(startup.statusCode, 200);
    const initial = startup.json();
    assert.equal(initial.products.length, 24);
    assert.ok(
      initial.products.every(
        (p: any) => p._summary && !p.tasks[0].prompt && !p.promptSets,
      ),
    );
    assert.equal(initial.sheetLoaded, false);
    assert.equal(initial.sheetSnapshot, undefined);
    assert.equal(initial.hasKey, true);
    assert.equal(initial.hasPromptKey, true);
    assert.equal(initial.jobTotal, 181);
    assert.equal(initial.jobs.length, 1);
    assert.equal(initial.jobs[0].productSnapshot, undefined);
    assert.equal(initial.jobs[0].analysisResponse, undefined);
    assert.equal(initial.jobs[0].promptDrafts, undefined);
    assert.ok(startup.rawPayload.length < full.rawPayload.length / 20);
    console.log(
      `workspace bytes: full=${full.rawPayload.length}, startup=${startup.rawPayload.length}`,
    );
    const compressed = await read("/api/workspace/startup", {
      "accept-encoding": "gzip",
    });
    assert.equal(compressed.headers["content-encoding"], "gzip");
    assert.deepEqual(
      JSON.parse(gunzipSync(compressed.rawPayload).toString()),
      initial,
    );
    assert.ok(compressed.rawPayload.length < startup.rawPayload.length / 3);
    const brotli = await read("/api/workspace/startup", {
      "accept-encoding": "br",
    });
    assert.equal(brotli.headers["content-encoding"], "br");
    assert.deepEqual(
      JSON.parse(brotliDecompressSync(brotli.rawPayload).toString()),
      initial,
    );
    console.log(
      `startup compressed: gzip=${compressed.rawPayload.length}, br=${brotli.rawPayload.length}`,
    );
    assert.equal(startup.headers["cache-control"], "no-store");
    assert.equal(
      (await f.app.inject("/api/workspace/startup")).statusCode,
      401,
    );
    assert.equal(
      (
        await read("/api/workspace", {
          "x-workspace-view": "compact",
          "x-workspace-products": "null",
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await read("/api/workspace/products?ids=not-in-this-space")).statusCode,
      404,
    );
    const details = (
      await read(`/api/workspace/products?ids=${f.product.id}`)
    ).json();
    const detail = details.products[0];
    assert.ok(details.jobs[0].promptDrafts.尺寸图);
    assert.equal(detail._summary, undefined);
    assert.equal(detail.tasks[0].promptHistory.length, 4);
    const compact = {
      "x-workspace-view": "compact",
      "x-workspace-products": JSON.stringify([f.product.id]),
    };
    const edited = await f.app.inject({
      method: "PATCH",
      url: "/api/workspace",
      headers: { ...headers, ...compact },
      payload: {
        edits: [
          {
            path: ["products", f.product.id, "name"],
            before: detail.name,
            value: "changed without losing history",
          },
        ],
      },
    });
    assert.equal(edited.statusCode, 200);
    assert.equal(
      edited.json().products.filter((p: any) => !p._summary).length,
      1,
    );
    assert.equal(edited.json().sheetSnapshot, undefined);
    const delta = (
      await read(`/api/workspace/changes?since=${initial.syncCursor}`, compact)
    ).json();
    assert.equal(delta.products.length, 1);
    assert.equal(delta.products[0].name, "changed without losing history");
    assert.equal(delta.products[0]._summary, undefined);
    assert.equal(delta.replaceJobs, true);
    const idle = (
      await read(`/api/workspace/changes?since=${delta.cursor}`, compact)
    ).json();
    assert.deepEqual(idle.products, []);
    assert.deepEqual(idle.jobs, []);
    const history = (await read("/api/jobs/history?page=2")).json();
    assert.equal(history.jobs.length, 50);
    assert.ok(
      history.jobs.every(
        (job: any) => !job.productSnapshot && !job.analysisResponse,
      ),
    );
    const all = (
      await read("/api/workspace", {
        ...compact,
        "x-workspace-products": "all",
        "x-workspace-sheet": "1",
      })
    ).json();
    assert.ok(all.products.every((p: any) => !p._summary));
    assert.ok(all.sheetSnapshot.sheets.preview);
    assert.equal(all.products[0].tasks[0].promptHistory.length, 4);
    assert.equal((await f.workflows.repo.view()).jobs.length, 181);
    assert.ok((await f.workflows.repo.view()).jobs[0].productSnapshot);
  } finally {
    await f.close();
  }
});

test("loading a product preserves edits made during the request and does not turn unloaded summaries into deletions", async () => {
  const a = newProduct("A"),
    b = newProduct("B");
  const state: any = {
    common: "rules",
    concurrency: 2,
    settings: {},
    jobs: [],
    partial: true,
    sheetLoaded: false,
    syncCursor: 7,
    products: [a, { ...b, _summary: true }],
  };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previousFetch = globalThis.fetch;
  let requestedHeaders: any;
  globalThis.fetch = async (_url, options) => {
    requestedHeaders = options?.headers;
    await gate;
    return new Response(JSON.stringify({ products: [b] }));
  };
  const client = new WorkspaceClient(state, {
    render() {},
    sync() {},
    notify() {},
  });
  try {
    const reading = client.loadProducts([b.id]);
    await new Promise((resolve) => setImmediate(resolve));
    a.name = "typed while the detail was loading";
    release();
    await reading;
    assert.equal(state.products[0].name, "typed while the detail was loading");
    assert.equal(state.products[1]._summary, undefined);
    assert.equal(state.syncCursor, 7);
    const edits = differences(editable(client.baseline), editable(state));
    assert.equal(edits.length, 1);
    assert.deepEqual(edits[0].path, ["products", a.id, "name"]);
    assert.equal(requestedHeaders["x-workspace-view"], "compact");
    assert.deepEqual(JSON.parse(requestedHeaders["x-workspace-products"]), [
      a.id,
    ]);
    assert.equal(Object.hasOwn(editable(state), "sheetSnapshot"), false);
  } finally {
    release();
    globalThis.fetch = previousFetch;
  }
});
