import test from "node:test";
import assert from "node:assert/strict";
import { imageGeneration } from "../../../src/view-models/image-generation.js";

test("image placeholder derives queued, submitting and real platform progress from the current card job", () => {
  const job = {
    id: "image",
    taskId: "card",
    kind: "image",
    status: "queued",
    createdAt: 2,
  };
  assert.equal(imageGeneration("other", [job]), null);
  assert.equal(imageGeneration("card", [job]).label, "等待生成");
  assert.equal(imageGeneration("card", [job], true).label, "队列已暂停");
  assert.equal(
    imageGeneration("card", [{ ...job, status: "running" }]).phase,
    "submitting",
  );
  const accepted = { ...job, remoteId: "remote", progress: 46 };
  assert.equal(imageGeneration("card", [accepted], true).progress, 46);
  for (const value of [undefined, 0, -1, "invalid"])
    assert.equal(
      imageGeneration("card", [{ ...accepted, progress: value }]).progress,
      null,
    );
  assert.equal(
    imageGeneration("card", [{ ...accepted, progress: 120 }]).progress,
    100,
  );
  for (const status of ["completed", "failed", "cancelled", "interrupted"])
    assert.equal(
      imageGeneration("card", [accepted, { ...job, createdAt: 3, status }]),
      null,
    );
  assert.equal(
    imageGeneration("card", [
      { ...job, dependsOn: "analysis" },
      { id: "analysis", kind: "prompt-set", status: "running" },
    ]).phase,
    "preparing",
  );
});
