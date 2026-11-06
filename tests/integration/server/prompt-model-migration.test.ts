import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, loginHeaders, pairs } from "../../support/production.js";
import { migrate } from "../../../server/production/database.js";
import { DOUBAO_DEFAULT_MODEL } from "../../../shared/doubao.js";

test("019 initializes every workspace's prompt model once while preserving keys, personal settings and queued jobs", async () => {
  const f = await fixture();
  try {
    assert.equal(DOUBAO_DEFAULT_MODEL, "doubao-seed-2-1-pro-260915");
    assert.equal(
      (await f.workflows.settings()).promptModel,
      DOUBAO_DEFAULT_MODEL,
    );
    const headers = await loginHeaders(f.app);
    const personal = await f.app.inject({
      method: "POST",
      url: "/api/workflow/settings",
      headers,
      payload: { imageModel: "gpt-image-2", gptSize: "1536x1024" },
    });
    assert.equal(personal.statusCode, 200, personal.body);
    await f.workflows.updateSettings({
      promptModel: "ep-configured-before-upgrade",
      baseUrl: "https://grsaiapi.com",
    });
    await f.workflows.enqueue(randomUUID(), pairs(f.product), "prompt-set");
    const source = (
      await f.db.query("SELECT * FROM workspace WHERE id='default'")
    ).rows[0];
    for (const [id, model, archivedAt] of [
      ["old-doubao", "doubao-previous-pro", null],
      ["archived-endpoint", "ep-archived", 1],
      ["already-default", DOUBAO_DEFAULT_MODEL, null],
      ["missing-model", undefined, null],
    ] as const) {
      const document = structuredClone(source.document);
      if (model === undefined) delete document.settings.promptModel;
      else document.settings.promptModel = model;
      await f.db.query(
        "INSERT INTO workspace(id,document,credential,prompt_credential,archived_at) VALUES($1,$2,$3,$4,$5)",
        [id, document, source.credential, source.prompt_credential, archivedAt],
      );
    }
    const workspaces = (await f.db.query("SELECT * FROM workspace ORDER BY id"))
      .rows;
    const members = (
      await f.db.query("SELECT * FROM member_generation_settings")
    ).rows;
    assert.ok(members.length > 0);
    const jobs = (await f.db.query("SELECT * FROM jobs")).rows;
    assert.ok(jobs.length > 0);
    const products = (await f.db.query("SELECT * FROM products")).rows;
    await f.db.query("DELETE FROM schema_migrations WHERE version='019.sql'");
    const history = (
      await f.db.query("SELECT * FROM schema_migrations ORDER BY version")
    ).rows;

    await migrate(f.db);
    assert.deepEqual(
      (await f.db.query("SELECT * FROM workspace ORDER BY id")).rows,
      workspaces.map((row) => ({
        ...row,
        document: {
          ...row.document,
          settings: {
            ...row.document.settings,
            promptProvider: "doubao",
            promptModel: DOUBAO_DEFAULT_MODEL,
          },
        },
      })),
    );
    assert.deepEqual(
      (await f.db.query("SELECT * FROM member_generation_settings")).rows,
      members,
    );
    assert.deepEqual((await f.db.query("SELECT * FROM jobs")).rows, jobs);
    assert.deepEqual(
      (await f.db.query("SELECT * FROM products")).rows,
      products,
    );
    assert.deepEqual(
      (
        await f.db.query(
          "SELECT * FROM schema_migrations WHERE version<'019.sql' ORDER BY version",
        )
      ).rows,
      history,
    );
    const effective = await f.app.inject({
      url: "/api/workflow/settings",
      headers,
    });
    assert.equal(effective.statusCode, 200);
    assert.equal(effective.json().promptModel, DOUBAO_DEFAULT_MODEL);
    assert.equal(effective.json().baseUrl, "https://grsaiapi.com");
    assert.equal(effective.json().gptSize, "1536x1024");
    assert.equal(effective.json().hasKey, true);
    assert.equal(effective.json().hasPromptKey, true);

    await f.workflows.updateSettings({
      promptModel: "ep-selected-after-upgrade",
    });
    for (let restart = 0; restart < 2; restart++) {
      await f.reopen();
      assert.equal(
        (await f.workflows.settings()).promptModel,
        "ep-selected-after-upgrade",
      );
    }
    assert.deepEqual((await f.db.query("PRAGMA foreign_key_check")).rows, []);
  } finally {
    await f.close();
  }
});
