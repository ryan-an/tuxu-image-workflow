import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceClient } from "../../../src/services/workspace-client.js";

test("workspace refreshes and save acknowledgements preserve personal settings and pending shared edits", async () => {
  const personal = { imageSize: "2K", promptModel: "ep-personal" };
  const state = {
    settings: personal,
    common: "original",
    products: [],
    jobs: [],
    concurrency: 2,
    paused: false,
  };
  const client = new WorkspaceClient(state, {
    render() {},
    sync: async () => {},
    notify() {},
  });
  state.common = "pending shared edit";
  const remote = {
    ...structuredClone(state),
    common: "remote",
    settings: { imageSize: "4K", promptModel: "ep-other" },
  };
  await client.accept(remote, [
    { path: ["common"], before: "original", value: "pending shared edit" },
  ]);
  assert.deepEqual(state.settings, { ...personal, promptModel: "ep-other" });
  assert.equal(state.common, "pending shared edit");
  assert.equal(remote.settings.promptModel, "ep-other");
  const saved = client.savedWorkspace({
    editResult: "delta",
    document: { common: "saved", settings: remote.settings },
    products: [],
  });
  await client.accept(saved);
  assert.deepEqual(state.settings, { ...personal, promptModel: "ep-other" });
  assert.equal(state.common, "saved");
});
