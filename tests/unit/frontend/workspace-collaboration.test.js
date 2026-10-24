import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceClient } from "../../../src/services/workspace-client.js";
import { newProduct } from "../../../shared/model.js";
import {
  applyLatestEdits,
  cellContent,
} from "../../../shared/workspace-edits.js";

test("empty rich-text caches and stale format-only saves cannot erase another editor's text", () => {
  const rich = { p: { body: { dataStream: "saved text\r\n" } }, s: "prompt" };
  const target = {
    sheetSnapshot: { sheets: { preview: { cellData: { 2: { 4: rich } } } } },
  };
  const path = ["sheetSnapshot", "sheets", "preview", "cellData", "2", "4"];
  applyLatestEdits(target, [
    { path, before: { v: "", s: "prompt" }, value: { v: "", s: "normalized" } },
  ]);
  assert.equal(
    cellContent(target.sheetSnapshot.sheets.preview.cellData[2][4]).v,
    "saved text",
  );
  const before = structuredClone(
    target.sheetSnapshot.sheets.preview.cellData[2][4],
  );
  applyLatestEdits(target, [{ path, before, value: { ...before, v: "" } }]);
  assert.equal(target.sheetSnapshot.sheets.preview.cellData[2][4].v, undefined);
  assert.equal(
    cellContent(target.sheetSnapshot.sheets.preview.cellData[2][4]).v,
    "saved text",
  );
});

test("remote cell updates never alias the local editing baseline and later edits are actually submitted", async (t) => {
  const state = {
    common: "",
    concurrency: 2,
    products: [newProduct("one")],
    jobs: [],
    sheetSnapshot: {
      sheets: { preview: { cellData: { 2: { 4: { v: "original" } } } } },
    },
  };
  const remote = structuredClone(state);
  const client = new WorkspaceClient(state, {
    render() {},
    sync() {},
    notify() {},
  });
  await client.accept(
    remote,
    [
      {
        path: ["sheetSnapshot", "sheets", "preview", "cellData", "2", "4"],
        before: { v: "original" },
        value: { v: "pending" },
      },
    ],
    true,
  );
  assert.equal(
    remote.sheetSnapshot.sheets.preview.cellData[2][4].v,
    "original",
  );
  assert.equal(
    client.baseline.sheetSnapshot.sheets.preview.cellData[2][4].v,
    "original",
  );
  state.sheetSnapshot.sheets.preview.cellData[2][4].v = "my next edit";
  let sent;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    sent = JSON.parse(options.body).edits;
    return Response.json(structuredClone(state));
  });
  await client.save();
  assert.equal(sent[0].value.v, "my next edit");
  assert.equal(sent[0].before.v, "original");
  assert.equal(
    remote.sheetSnapshot.sheets.preview.cellData[2][4].v,
    "original",
  );
});
