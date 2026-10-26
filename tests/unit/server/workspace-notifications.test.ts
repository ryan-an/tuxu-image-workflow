import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { WorkspaceCollaboration } from "../../../server/production/workspace-collaboration.js";

test("committed change bursts share one invalidation and later changes still notify", async () => {
  const collaboration = new WorkspaceCollaboration();
  const events: any[] = [];
  collaboration.on("event", (event) => events.push(event));
  for (let i = 0; i < 15; i++) collaboration.changed();
  assert.equal(events.length, 0);
  await delay(150);
  assert.deepEqual(events, [{ type: "changed" }]);
  collaboration.changed();
  await delay(150);
  assert.deepEqual(events, [{ type: "changed" }, { type: "changed" }]);
});
