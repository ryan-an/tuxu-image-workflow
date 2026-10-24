import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { database, migrate } from "../../../server/production/database.js";
import {
  emptyWorkspace,
  Repository,
} from "../../../server/production/repository.js";
import { Accounts } from "../../../server/production/accounts.js";
import { Members } from "../../../server/production/members.js";
import { Provisioning } from "../../../server/production/provisioning.js";

test("009 through 011 preserve identities, member bindings and successful-image usage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tuxu-team-migration-"));
  const db = database(join(directory, "workspace.sqlite"));
  try {
    await db.query(
      "CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,checksum TEXT NOT NULL)",
    );
    for (let i = 1; i <= 8; i++) {
      const name = `${String(i).padStart(3, "0")}.sql`;
      const sql = await readFile(
        new URL(
          `../../../server/production/sqlite-migrations/${name}`,
          import.meta.url,
        ),
        "utf8",
      );
      await db.query(sql);
      await db.query(
        "INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)",
        [name, createHash("sha256").update(sql).digest("hex")],
      );
    }
    const { products, jobs, ...document } = emptyWorkspace();
    await db.query(
      "INSERT INTO workspace(id,document,credential,prompt_credential) VALUES('default',$1,'encrypted-image','encrypted-chat')",
      [document],
    );
    await db.query(
      "INSERT INTO accounts(id,username,display_name,role,status,password_hash,monthly_limit,created_at) VALUES('owner','admin','原所有者','owner','active','owner-hash',NULL,1)",
    );
    await db.query(
      "INSERT INTO accounts(id,username,display_name,role,status,password_hash,monthly_limit,created_at) VALUES('legacy-member','legacy_member','旧成员','editor','active','member-hash',10,2)",
    );
    await db.query(
      "INSERT INTO account_sessions VALUES('session-hash','legacy-member',9999999999999)",
    );
    await db.query(
      "INSERT INTO account_invitations VALUES('invitation-hash','legacy-member',9999999999999)",
    );
    await db.query(
      "INSERT INTO account_usage VALUES('legacy-member','2000-01',7)",
    );
    await db.query(
      "INSERT INTO usage_reservations VALUES('enqueue:legacy','legacy-member','2000-01',1)",
    );
    await db.query(
      "INSERT INTO products(id,workspace_id,code,document) VALUES('legacy-product','default','LEGACY',$1)",
      [{}],
    );
    for (const [id, kind, status, accountId] of [
      ["successful-image", "image", "completed", "legacy-member"],
      ["failed-image", "image", "failed", "legacy-member"],
      ["successful-analysis", "prompt-set", "completed", "legacy-member"],
      ["unattributed-image", "image", "completed", "missing-member"],
    ]) {
      await db.query(
        "INSERT INTO jobs(id,workspace_id,product_id,kind,status,payload) VALUES($1,'default','legacy-product',$2,$3,$4)",
        [
          id,
          kind,
          status,
          {
            createdBy: { id: accountId },
            finishedAt: Date.UTC(2000, 0, 31, 18),
          },
        ],
      );
    }
    await db.query(
      "INSERT INTO commands(id,fingerprint,response) VALUES('legacy-command','fingerprint',$1)",
      [{ count: 1 }],
    );
    await db.query(
      "INSERT INTO assets(id,mime,bytes) VALUES($1,'image/png',100)",
      ["a".repeat(64)],
    );
    const cursor = (
      await db.query("SELECT revision FROM sync_clock WHERE id=1")
    ).rows[0].revision;
    await migrate(db);
    assert.deepEqual((await db.query("PRAGMA foreign_key_check")).rows, []);
    const workspace = (
      await db.query("SELECT * FROM workspace WHERE id='default'")
    ).rows[0];
    assert.equal(workspace.credential, "encrypted-image");
    assert.equal(workspace.prompt_credential, "encrypted-chat");
    assert.equal(workspace.name, "默认团队");
    assert.equal((await new Members(db).list()).length, 2);
    assert.equal(
      (
        await db.query(
          "SELECT password_hash FROM accounts WHERE id='legacy-member'",
        )
      ).rows[0].password_hash,
      "member-hash",
    );
    assert.equal(
      (await db.query("SELECT * FROM account_sessions")).rows[0].token_hash,
      "session-hash",
    );
    assert.equal(
      (await db.query("SELECT * FROM workspace_invitations")).rows[0]
        .token_hash,
      "invitation-hash",
    );
    assert.equal(
      (await db.query("SELECT * FROM account_image_usage")).rows[0].job_id,
      "successful-image",
    );
    assert.deepEqual((await db.query("SELECT * FROM account_usage")).rows, [
      {
        workspace_id: "default",
        account_id: "legacy-member",
        period: "2000-02",
        used: 1,
      },
    ]);
    await migrate(db);
    assert.equal(
      (await db.query("SELECT used FROM account_usage")).rows[0].used,
      1,
    );
    assert.equal(
      (await db.query("SELECT workspace_id FROM commands")).rows[0]
        .workspace_id,
      "default",
    );
    assert.equal(
      (await db.query("SELECT workspace_id FROM assets")).rows[0].workspace_id,
      "default",
    );
    assert.equal(await new Repository(db).cursor(), cursor);
  } finally {
    await db.close();
    if (
      dirname(resolve(directory)) !== resolve(tmpdir()) ||
      !basename(directory).startsWith("tuxu-team-migration-")
    )
      throw new Error("拒绝清理非测试目录");
    await rm(directory, { recursive: true, force: true });
  }
});
