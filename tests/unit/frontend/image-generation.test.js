import test from "node:test";
import assert from "node:assert/strict";
import { imageGeneration } from "../../../src/view-models/image-generation.js";
import { createFormCommands } from "../../../src/application/form-commands.js";
import { newProduct } from "../../../shared/model.js";

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
  for (const status of ["completed", "failed", "cancelled"])
    assert.equal(
      imageGeneration("card", [{ ...job, createdAt: 3, status }]),
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

test("a collaborator's older active image task stays visible ahead of newer finished attempts", () => {
  const active = {
    id: "active",
    taskId: "card",
    kind: "image",
    status: "queued",
    createdAt: 1,
    remoteId: "platform-task",
    progress: 46,
    createdBy: { id: "alice", displayName: "协作者甲", username: "alice" },
  };
  for (const status of ["completed", "failed", "cancelled"]) {
    const newer = { ...active, id: "newer", createdAt: 2, status };
    for (const jobs of [
      [active, newer],
      [newer, active],
    ]) {
      const generation = imageGeneration("card", jobs);
      assert.equal(generation.jobId, active.id);
      assert.equal(generation.progress, 46);
      assert.equal(generation.submittedBy, "协作者甲");
    }
  }
});

test("interrupted image tasks show recovery instead of disappearing or claiming live progress", () => {
  const job = {
    id: "interrupted",
    taskId: "card",
    kind: "image",
    mode: "live",
    status: "interrupted",
    createdAt: 1,
    progress: 46,
    stage: "submitting",
  };
  const unknown = imageGeneration("card", [job]);
  assert.equal(unknown.label, "生图待核对");
  assert.equal(unknown.progress, null);
  assert.deepEqual(unknown.recovery, {
    action: "reconcile-job",
    label: "核对平台",
  });
  const accepted = imageGeneration("card", [
    { ...job, remoteId: "platform-task" },
  ]);
  assert.equal(accepted.label, "生图已中断");
  assert.deepEqual(accepted.recovery, {
    action: "query-job",
    label: "继续查询",
  });
  const pending = imageGeneration("card", [{ ...job, stage: "pending" }]);
  assert.equal(pending.label, "生图待恢复");
  assert.deepEqual(pending.recovery, {
    action: "retry-job",
    label: "恢复任务",
  });
  assert.equal(
    imageGeneration("card", [{ ...job, mode: "demo" }]).recovery.action,
    "retry-job",
  );
});

test("saving a prompt explains the collaborator's existing task without replacing its frozen input", async () => {
  const product = newProduct("SHARED");
  const task = product.tasks[0];
  const job = {
    id: "shared-job",
    kind: "image",
    taskId: task.id,
    createdAt: 1,
    status: "queued",
    remoteId: "platform-task",
    progress: 46,
    prompt: "原任务提示词",
    createdBy: { displayName: "协作者甲" },
  };
  const commands = createFormCommands({
    state: { products: [product], jobs: [job] },
    change: () => {},
    syncTask: async () => {},
    persist: async () => {},
    queue: { enqueue: async () => 0 },
    notify: () => {},
  });
  await assert.rejects(
    commands.saveTaskPromptAndGenerate(product.id, task.id, "新提示词"),
    /提示词已保存.*正在生成图片 46%.*协作者甲.*本次修改不影响原任务/,
  );
  assert.equal(task.prompt, "新提示词");
  assert.equal(job.prompt, "原任务提示词");
  job.status = "interrupted";
  await assert.rejects(
    commands.saveTaskPromptAndGenerate(product.id, task.id, "另一次修改"),
    /生图已中断.*继续查询/,
  );
});
