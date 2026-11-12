import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, loginHeaders, password } from "../../support/production.js";
import { migrate } from "../../../server/production/database.js";
import { Members } from "../../../server/production/members.js";
import {
  memberGenerationSettings,
  saveMemberGenerationSettings,
} from "../../../server/production/member-generation-settings.js";
import {
  DEFAULT_CONFIG,
  generationPayload,
} from "../../../shared/provider-config.js";

test("021 initializes workspace and personal image models once, retaining sizes, keys and queued configurations", async () => {
  const f = await fixture();
  try {
    assert.equal(DEFAULT_CONFIG.imageModel, "gpt-image-2");
    assert.equal(
      generationPayload({}, { prompt: "test" }).model,
      "gpt-image-2",
    );
    assert.equal((await f.workflows.settings()).imageModel, "gpt-image-2");
    const headers = await loginHeaders(f.app);
    const ownerId = (
      await f.db.query(
        "SELECT account_id FROM workspace_members WHERE workspace_id='default' AND role='owner'",
      )
    ).rows[0].account_id;
    const members = new Members(f.db);
    const editor = await members.create({
      username: "image-migration-editor",
      displayName: "image editor",
      role: "editor",
      password,
      monthlyLimit: null,
    });
    const unsaved = await members.create({
      username: "image-migration-unsaved",
      displayName: "no saved preferences",
      role: "editor",
      password,
      monthlyLimit: null,
    });
    await f.workflows.updateSettings({
      imageModel: "gpt-image-2-vip",
      quality: "medium",
      gptSize: "1536x1024",
      imageSize: "2K",
      aspectRatio: "16:9",
      promptModel: "ep-retained-conversation",
      baseUrl: "https://grsaiapi.com",
    });
    const oldSettings = await f.workflows.settings();
    await saveMemberGenerationSettings(f.db, "default", ownerId, oldSettings);
    await saveMemberGenerationSettings(f.db, "default", editor.id, {
      ...oldSettings,
      imageModel: "nano-banana-pro",
      imageSize: "4K",
      quality: "high",
    });
    await f.workflows.enqueue(
      randomUUID(),
      [{ productId: f.product.id, taskId: f.product.tasks[0].id }],
      "full-workflow",
    );
    const oldJobs = (await f.db.query("SELECT * FROM jobs ORDER BY id")).rows;
    assert.ok(oldJobs.length > 0);
    assert.ok(
      oldJobs.every(
        (row) => row.payload.config.imageModel === "gpt-image-2-vip",
      ),
    );

    const created = await f.app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers,
      payload: { name: "image migration archived workspace" },
    });
    assert.equal(created.statusCode, 200, created.body);
    const archivedId = created.json().id;
    const archived = await f.workspaces.get(archivedId);
    assert.equal((await archived.settings()).imageModel, "gpt-image-2");
    await archived.updateSettings({
      imageModel: "gpt-image-2.5-sunburst",
      quality: "max",
    });
    await saveMemberGenerationSettings(f.db, archivedId, ownerId, {
      ...oldSettings,
      imageModel: "nano-banana-2",
    });
    await f.db.query("UPDATE workspace SET archived_at=1 WHERE id=$1", [
      archivedId,
    ]);
    const missing = structuredClone(
      (await f.db.query("SELECT document FROM workspace WHERE id='default'"))
        .rows[0].document,
    );
    delete missing.settings.imageModel;
    delete missing.settings.quality;
    await f.db.query("INSERT INTO workspace(id,document) VALUES($1,$2)", [
      "missing-image-model",
      missing,
    ]);
    const workspaces = (await f.db.query("SELECT * FROM workspace ORDER BY id"))
      .rows;
    const preferences = (
      await f.db.query(
        "SELECT * FROM member_generation_settings ORDER BY workspace_id,account_id",
      )
    ).rows;
    assert.equal(
      preferences.some((row) => row.account_id === unsaved.id),
      false,
    );
    const products = (await f.db.query("SELECT * FROM products ORDER BY id"))
      .rows;
    const history = (
      await f.db.query(
        "SELECT * FROM schema_migrations WHERE version<'021.sql' ORDER BY version",
      )
    ).rows;
    await f.db.query("DELETE FROM schema_migrations WHERE version='021.sql'");
    await migrate(f.db);

    assert.deepEqual(
      (await f.db.query("SELECT * FROM workspace ORDER BY id")).rows,
      workspaces.map((row) => ({
        ...row,
        document: {
          ...row.document,
          settings: {
            ...row.document.settings,
            imageModel: "gpt-image-2",
            quality: "auto",
          },
        },
      })),
    );
    assert.deepEqual(
      (
        await f.db.query(
          "SELECT * FROM member_generation_settings ORDER BY workspace_id,account_id",
        )
      ).rows,
      preferences.map((row) => ({
        ...row,
        document: {
          ...row.document,
          imageModel: "gpt-image-2",
          quality: "auto",
        },
      })),
    );
    assert.deepEqual(
      (await f.db.query("SELECT * FROM jobs ORDER BY id")).rows,
      oldJobs,
    );
    assert.deepEqual(
      (await f.db.query("SELECT * FROM products ORDER BY id")).rows,
      products,
    );
    assert.deepEqual(
      (
        await f.db.query(
          "SELECT * FROM schema_migrations WHERE version<'021.sql' ORDER BY version",
        )
      ).rows,
      history,
    );
    for (const [workspaceId, accountId] of [
      ["default", ownerId],
      ["default", editor.id],
      ["default", unsaved.id],
      [archivedId, ownerId],
    ]) {
      const defaults = (
        await f.db.query("SELECT document FROM workspace WHERE id=$1", [
          workspaceId,
        ])
      ).rows[0].document.settings;
      const config = await memberGenerationSettings(
        f.db,
        workspaceId,
        accountId,
        defaults,
      );
      const payload: Record<string, unknown> = generationPayload(config, {
        prompt: "test",
      });
      assert.equal(payload.model, "gpt-image-2");
      assert.equal(payload.quality, "auto");
      assert.equal(payload.aspectRatio, "1536x1024");
    }
    const current = await f.app.inject({
      url: "/api/workflow/settings",
      headers,
    });
    assert.equal(current.statusCode, 200);
    assert.equal(current.json().imageModel, "gpt-image-2");
    assert.equal(current.json().promptModel, "ep-retained-conversation");
    assert.equal(current.json().hasKey, true);
    assert.equal(current.json().hasPromptKey, true);

    const selected = await f.app.inject({
      method: "POST",
      url: "/api/workflow/settings",
      headers,
      payload: { imageModel: "nano-banana-2" },
    });
    assert.equal(selected.statusCode, 200, selected.body);
    await f.workflows.updateSettings({ imageModel: "nano-banana-fast" });
    for (let restart = 0; restart < 2; restart++) {
      await f.reopen();
      const personal = await f.app.inject({
        url: "/api/workflow/settings",
        headers,
      });
      assert.equal(personal.json().imageModel, "nano-banana-2");
      assert.equal(
        (await f.workflows.settings()).imageModel,
        "nano-banana-fast",
      );
    }
    assert.deepEqual((await f.db.query("PRAGMA foreign_key_check")).rows, []);
  } finally {
    await f.close();
  }
});
