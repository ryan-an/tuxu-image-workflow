import test from "node:test";
import assert from "node:assert/strict";
import { fixture, loginHeaders, png } from "../../support/production.js";
import {
  SheetBridge,
  workflowSnapshot,
  detectColumns,
  parseSheet,
} from "../../../src/integrations/sheet-bridge.js";
import { newProduct } from "../../../shared/model.js";
import { productPage } from "../../../src/view-models/product-page.js";
import sharp from "sharp";

test("change cursor returns only committed changed entities, deletions and idle empty responses", async () => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app);
    const initial = (
      await f.app.inject({ url: "/api/workspace", headers })
    ).json();
    const since = initial.syncCursor;
    const get = () =>
      f.app.inject({ url: `/api/workspace/changes?since=${since}`, headers });
    let delta = (await get()).json();
    assert.deepEqual(delta.products, []);
    assert.deepEqual(delta.jobs, []);
    assert.equal(delta.document, undefined);
    await assert.rejects(
      f.db.transaction(async (tx) => {
        await f.workflows.repo.saveProduct(tx, {
          ...f.product,
          name: "rollback",
        });
        throw Error("rollback");
      }),
    );
    assert.equal((await get()).json().cursor, since);
    await f.db.transaction((tx) =>
      f.workflows.repo.saveProduct(tx, { ...f.product, name: "changed" }),
    );
    delta = (await get()).json();
    assert.equal(delta.products.length, 1);
    assert.equal(delta.products[0].name, "changed");
    assert.ok(delta.cursor > since);
    await f.db.query("DELETE FROM products WHERE id=$1", [f.product.id]);
    delta = (await get()).json();
    assert.deepEqual(delta.products, []);
    assert.deepEqual(delta.deletedProducts, [f.product.id]);
    assert.equal(
      (await f.app.inject({ url: "/api/workspace/changes?since=-1", headers }))
        .statusCode,
      400,
    );
    assert.equal(
      (
        await f.app.inject({
          url: "/api/workspace/changes?since=9007199254740991",
          headers,
        })
      ).json().reset,
      true,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/workspace/changes?since=0" }))
        .statusCode,
      401,
    );
  } finally {
    await f.close();
  }
});

test("1000 products project only 30, retain off-page writes, restore originals and preserve page edits", async () => {
  const products = Array.from({ length: 1000 }, (_, i) =>
    newProduct(`P${String(i).padStart(4, "0")}`),
  );
  products[30].photo = "/api/assets/" + "a".repeat(64);
  const state: any = {
    products,
    sheetSnapshot: workflowSnapshot({ products }),
  };
  const bridge: any = new SheetBridge(
    state,
    () => {},
    () => {},
  );
  const ui: any = { productPage: 2, search: "" };
  const page = productPage(state, ui);
  assert.equal(page.pages, 34);
  assert.equal(page.products.length, 30);
  bridge.setProducts(page.products);
  let mounted = bridge.project();
  const preview = mounted.sheets.preview;
  assert.equal(preview.rowCount, 100);
  assert.equal(parseSheet(preview, detectColumns(preview)).length, 30);
  assert.equal(preview.cellData[1][0].v, products[30].code);
  const photoColumn = detectColumns(preview).photoColumn;
  const image: any = Object.values(
    preview.cellData[1][photoColumn].p.drawings,
  )[0];
  assert.ok(image.source.endsWith("/thumbnail"));
  let saveCount = 0;
  bridge.workbook = {
    save: () => {
      saveCount++;
      return structuredClone(mounted);
    },
    getSheetBySheetId: () => ({ getRange: () => ({ setValues: () => {} }) }),
  };
  mounted.sheets.preview.cellData[2][4] = { v: "local edited prompt" };
  bridge.capture();
  assert.equal(
    state.sheetSnapshot.sheets.preview.cellData[92][4].v,
    "local edited prompt",
  );
  const original: any = Object.values(
    state.sheetSnapshot.sheets.preview.cellData[91][photoColumn].p.drawings,
  )[0];
  assert.equal(original.source, products[30].photo);
  products[0].tasks[0].prompt = "background completion";
  await bridge.batch(() =>
    bridge.sync(products[0], products[0].tasks[0], "prompt"),
  );
  assert.equal(
    state.sheetSnapshot.sheets.preview.cellData[2][4].v,
    "background completion",
  );
  assert.ok(saveCount <= 4);
  bridge.workbook = null;
  bridge.setProducts(products.slice(0, 30));
  mounted = bridge.project();
  assert.equal(
    mounted.sheets.preview.cellData[2][4].v,
    "background completion",
  );
  assert.equal(
    state.sheetSnapshot.sheets.preview.cellData[92][4].v,
    "local edited prompt",
  );
  assert.equal(
    productPage(state, { ...ui, productPage: 999 }).products.length,
    10,
  );
  assert.equal(
    productPage(state, { ...ui, search: "P0999" }).products.length,
    1,
  );
});

test("asset thumbnails are bounded, cached and never replace stored originals", async () => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app);
    const original = await sharp({
      create: { width: 1600, height: 1200, channels: 3, background: "#f00" },
    })
      .png()
      .toBuffer();
    const path = await f.workflows.assets.put(original, "image/png");
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        f.app.inject({ url: path + "/thumbnail", headers }),
      ),
    );
    for (const r of responses) {
      assert.equal(r.statusCode, 200);
      const m = await sharp(r.rawPayload).metadata();
      assert.ok(m.width! <= 320 && m.height! <= 320);
      assert.equal(m.format, "webp");
    }
    assert.deepEqual(
      (await f.app.inject({ url: path, headers })).rawPayload,
      original,
    );
    assert.equal(
      (await f.app.inject({ url: path + "/thumbnail" })).statusCode,
      401,
    );
  } finally {
    await f.close();
  }
});

test("incremental client preserves local drafts, skips idle renders and coalesces concurrent refreshes", async () => {
  const { WorkspaceClient } = await import(
    "../../../src/services/workspace-client.js"
  );
  const { emptyWorkspace } = await import(
    "../../../server/production/repository.js"
  );
  const state: any = {
    ...emptyWorkspace(),
    syncCursor: 0,
    products: [newProduct("ONE"), newProduct("TWO")],
  };
  let renders = 0,
    calls = 0,
    syncs = 0;
  const client = new WorkspaceClient(state, {
    render: () => renders++,
    sync: async () => {
      syncs++;
    },
    notify: () => {},
  });
  state.products[0].name = "unsaved local draft";
  const changed = structuredClone(state.products[1]);
  changed.tasks[0].prompt = "remote finished";
  const previous = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return new Response(
      JSON.stringify({
        cursor: 1,
        products: calls === 1 ? [changed] : [],
        jobs: [],
        deletedProducts: [],
        deletedJobs: [],
      }),
    );
  };
  try {
    await Promise.all([client.refresh(), client.refresh(), client.refresh()]);
    assert.equal(calls, 1);
    assert.equal(state.products[0].name, "unsaved local draft");
    assert.equal(state.products[1].tasks[0].prompt, "remote finished");
    assert.equal(syncs, 1);
    const rendered = renders;
    await client.refresh();
    assert.equal(renders, rendered);
    assert.equal(client.cursor, 1);
  } finally {
    globalThis.fetch = previous;
  }
});
