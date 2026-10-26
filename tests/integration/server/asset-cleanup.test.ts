import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { access, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { fixture } from "../../support/production.js";
import { AssistantConversations } from "../../../server/production/assistant-conversations.js";

test("job snapshots, command results and consultation messages each protect an otherwise unused image", async () => {
  const f = await fixture();
  try {
    const sources: string[] = [];
    for (const background of ["yellow", "purple", "orange"])
      sources.push(
        await f.workflows.assets.put(
          await sharp({
            create: { width: 2, height: 2, channels: 3, background },
          })
            .png()
            .toBuffer(),
          "image/png",
        ),
      );
    await f.db.transaction(async (tx) => {
      await f.workflows.repo.insertJob(tx, {
        id: randomUUID(),
        productId: f.product.id,
        taskId: f.product.tasks[0].id,
        kind: "image",
        status: "completed",
        stage: "completed",
        referenceImages: [sources[0]],
        error: "",
        config: {},
        productName: "历史任务",
        role: f.product.tasks[0].role,
        mode: "live",
        createdAt: Date.now(),
      });
      await tx.query(
        "INSERT INTO commands(id,workspace_id,fingerprint,response) VALUES($1,'default','test',$2)",
        [randomUUID(), { nested: { source: sources[1] } }],
      );
      await tx.query("UPDATE assets SET created_at=0");
    });
    await new AssistantConversations(f.db).create({}, [
      { role: "user", content: sources[2] },
      { role: "assistant", content: "已收到图片" },
    ]);
    assert.equal((await f.workflows.assets.collectUnused()).deleted, 0);
    for (const source of sources)
      assert.ok(
        (await f.workflows.assets.get(source.split("/").at(-1)!)).bytes.length,
      );
  } finally {
    await f.close();
  }
});

test("reuploading an old unreferenced image renews its protection during cleanup", async () => {
  const f = await fixture();
  try {
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "cyan" },
    })
      .png()
      .toBuffer();
    const source = await f.workflows.assets.put(bytes, "image/png");
    await f.db.query("UPDATE assets SET created_at=0");
    await f.workflows.assets.put(bytes, "image/png");
    assert.equal((await f.workflows.assets.collectUnused()).deleted, 0);
    assert.ok(
      (await f.workflows.assets.get(source.split("/").at(-1)!)).bytes.length,
    );
  } finally {
    await f.close();
  }
});

test("product deletion removes unreferenced originals, thumbnails and metadata while preserving shared images", async () => {
  const f = await fixture();
  try {
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const source = await f.workflows.assets.put(bytes, "image/png");
    const id = source.split("/").at(-1)!;
    await f.workflows.assets.thumbnail(id);
    await f.db.transaction(async (tx) => {
      const product = (await f.workflows.repo.view(tx)).products[0];
      product.photo = source;
      product.photos = [source];
      product.tasks.forEach((task) => (task.references = [source]));
      await f.workflows.repo.saveProduct(tx, product);
      await tx.query("UPDATE assets SET created_at=0");
    });
    await f.workflows.deleteProduct(f.product.id);
    const root = join(dirname(f.filename), "assets");
    await assert.rejects(access(join(root, id)), { code: "ENOENT" });
    await assert.rejects(access(join(root, "thumbnails", `${id}.webp`)), {
      code: "ENOENT",
    });
    assert.equal((await f.db.query("SELECT * FROM assets")).rows.length, 0);
    assert.deepEqual(await f.workflows.assets.collectUnused(), {
      deleted: 0,
      bytes: 0,
    });
  } finally {
    await f.close();
  }
});

test("cleanup preserves all persisted references and recent uploads; expired imports and missing files are reclaimed", async () => {
  const f = await fixture();
  try {
    const make = async (background: string) =>
      f.workflows.assets.put(
        await sharp({
          create: { width: 2, height: 2, channels: 3, background },
        })
          .png()
          .toBuffer(),
        "image/png",
      );
    const sheet = await make("red"),
      staged = await make("green"),
      recent = await make("blue"),
      expired = await make("white");
    await f.db.transaction(async (tx) => {
      const state = await f.workflows.repo.view(tx);
      state.sheetSnapshot = { customImage: `${sheet}/thumbnail` } as any;
      await f.workflows.repo.saveWorkspace(tx, state);
      await tx.query(
        "INSERT INTO sheet_imports(id,workspace_id,document,expires_at) VALUES($1,'default',$2,$3)",
        [randomUUID(), { image: staged }, Date.now() + 60000],
      );
      await tx.query(
        "INSERT INTO sheet_imports(id,workspace_id,document,expires_at) VALUES($1,'default',$2,0)",
        [randomUUID(), { image: expired }],
      );
      await tx.query("UPDATE assets SET created_at=0 WHERE id<>$1", [
        recent.split("/").at(-1),
      ]);
    });
    const expiredId = expired.split("/").at(-1)!;
    await unlink(join(dirname(f.filename), "assets", expiredId));
    const cleaned = await f.workflows.assets.collectUnused();
    assert.equal(cleaned.deleted, 1);
    for (const source of [f.product.photo, sheet, staged, recent])
      assert.ok(
        (await f.workflows.assets.get(source.split("/").at(-1)!)).bytes.length,
      );
    await f.db.query("UPDATE sheet_imports SET expires_at=0");
    await f.db.query("UPDATE assets SET created_at=0");
    assert.equal((await f.workflows.assets.collectUnused()).deleted, 2);
  } finally {
    await f.close();
  }
});
