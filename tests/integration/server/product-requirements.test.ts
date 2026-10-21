import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { newProduct } from "../../../shared/model.js";
import { editable, differences } from "../../../shared/workspace-edits.js";
import {
  productRequirements,
  DEFAULT_COMMON,
  LEGACY_DEFAULT_COMMON,
  FIXED_PRODUCT_REQUIREMENTS,
  requirementSection,
  outputSpec,
} from "../../../shared/prompt-suite.js";
import { Worker } from "../../../server/production/worker.js";
import {
  fixture,
  pairs,
  counts,
  fakeProvider,
} from "../../support/production.js";
import type { Product } from "../../../server/production/types.js";

test("default suite preserves fixed requirements and role-specific output sizes", () => {
  assert.doesNotMatch(DEFAULT_COMMON, /豆包/);
  assert.equal(
    requirementSection(DEFAULT_COMMON, 3),
    FIXED_PRODUCT_REQUIREMENTS,
  );
  for (const role of newProduct("defaults").tasks.map((task) => task.role)) {
    assert.deepEqual(
      outputSpec(role),
      role.startsWith("A+")
        ? { width: 970, height: 600, dpi: "300" }
        : { width: 1610, height: 1610, dpi: "300" },
    );
  }
});

test("initialization upgrades only the saved legacy default and keeps product overrides", async () => {
  const f = await fixture();
  try {
    const state = await f.workflows.repo.view();
    state.common = LEGACY_DEFAULT_COMMON.replace(/\n/g, "\r\n");
    state.products[0].promptRequirements = "我的独立要求";
    await f.db.transaction(async (tx) => {
      await f.workflows.repo.saveWorkspace(tx, state);
      await f.workflows.repo.saveProduct(tx, state.products[0]);
    });
    await f.workflows.repo.initialize();
    const migrated = await f.workflows.repo.view();
    assert.equal(migrated.common, DEFAULT_COMMON);
    assert.equal(migrated.products[0].promptRequirements, "我的独立要求");
    migrated.common = "我的默认要求";
    await f.db.transaction((tx) =>
      f.workflows.repo.saveWorkspace(tx, migrated),
    );
    await f.workflows.repo.initialize();
    assert.equal((await f.workflows.repo.view()).common, "我的默认要求");
  } finally {
    await f.close();
  }
});

test("product requirements are isolated, durable, and frozen when analysis is queued", async () => {
  const f = await fixture();
  try {
    const initial = await f.workflows.repo.view();
    const other = newProduct("TEST-02", "另一个产品") as Product;
    other.photo = f.product.photo;
    other.photos = f.product.photos;
    other.tasks.forEach(
      (task) => (task.references = f.product.tasks[0].references),
    );
    const edited = structuredClone(initial);
    edited.products.push(other);
    edited.products[0].promptRequirements = "仅此产品：暖色背景，中文文案";
    await f.workflows.edit(differences(editable(initial), editable(edited)));
    await f.workflows.enqueue(
      randomUUID(),
      [...pairs(f.product).slice(0, 1), ...pairs(other).slice(0, 1)],
      "prompt",
    );
    await f.workflows.edit([
      {
        path: ["products", f.product.id, "promptRequirements"],
        before: edited.products[0].promptRequirements,
        value: "仅此产品：蓝色背景，英文文案",
      },
    ]);
    await f.reopen();
    const reopened = await f.workflows.repo.view();
    assert.equal(reopened.common, initial.common);
    assert.equal(
      reopened.products[0].promptRequirements,
      "仅此产品：蓝色背景，英文文案",
    );
    assert.equal(
      productRequirements(reopened.products[1], reopened.common),
      initial.common,
    );
    assert.equal(
      reopened.jobs.find((job) => job.productId === f.product.id)?.common,
      "仅此产品：暖色背景，中文文案",
    );
    assert.equal(
      reopened.jobs.find((job) => job.productId === other.id)?.common,
      initial.common,
    );
    const received = new Map<string, string>();
    const provider = fakeProvider(counts());
    const analyze = provider.analyze.bind(provider);
    provider.analyze = async (product, common, ...args) => {
      received.set(product.id, common);
      return analyze(product, common, ...args);
    };
    const worker = new Worker(f.workflows, provider);
    await worker.step();
    await worker.step();
    assert.equal(received.get(f.product.id), "仅此产品：暖色背景，中文文案");
    assert.equal(received.get(other.id), initial.common);
    await f.workflows.enqueue(
      randomUUID(),
      pairs(f.product).slice(0, 1),
      "prompt",
    );
    await worker.step();
    assert.equal(received.get(f.product.id), "仅此产品：蓝色背景，英文文案");
    await f.workflows.edit([
      {
        path: ["products", f.product.id, "promptRequirements"],
        before: "仅此产品：蓝色背景，英文文案",
        value: null,
      },
    ]);
    await f.workflows.enqueue(
      randomUUID(),
      pairs(f.product).slice(0, 1),
      "prompt",
    );
    await worker.step();
    assert.equal(received.get(f.product.id), initial.common);
  } finally {
    await f.close();
  }
});

test("legacy products inherit current defaults and requirements edits validate and detect conflicts", async () => {
  const f = await fixture();
  try {
    await f.db.transaction(async (tx) => {
      const product = (await f.workflows.repo.view(tx)).products[0];
      delete product.promptRequirements;
      await f.workflows.repo.saveProduct(tx, product);
    });
    const original = await f.workflows.repo.view();
    assert.equal(
      productRequirements(original.products[0], original.common),
      original.common,
    );
    const edit = {
      path: ["products", f.product.id, "promptRequirements"],
      before: null,
      value: "此产品独立的要求",
    };
    for (const value of [42, "   ", "x".repeat(100001)]) {
      await assert.rejects(f.workflows.edit([{ ...edit, value }]), /产品资料/);
    }
    await f.workflows.edit([edit]);
    await assert.rejects(
      f.workflows.edit([{ ...edit, value: "过期的修改" }]),
      /更新/,
    );
    assert.equal(
      (await f.workflows.repo.view()).products[0].promptRequirements,
      edit.value,
    );
  } finally {
    await f.close();
  }
});
