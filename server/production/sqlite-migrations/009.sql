ALTER TABLE workspace ADD COLUMN name TEXT NOT NULL DEFAULT '默认团队';

CREATE TABLE accounts_v2 (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace(id),
 username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
 status TEXT NOT NULL CHECK(status IN ('pending','active','disabled','deleted')),
 password_hash TEXT, monthly_limit INTEGER CHECK(monthly_limit IS NULL OR monthly_limit >= 0),
 created_at INTEGER NOT NULL
);
INSERT INTO accounts_v2 SELECT id,'default',username,display_name,role,status,password_hash,monthly_limit,created_at FROM accounts;
CREATE UNIQUE INDEX accounts_one_owner ON accounts_v2(workspace_id) WHERE role='owner';
CREATE INDEX accounts_workspace ON accounts_v2(workspace_id,status);
CREATE TABLE account_sessions_v2 (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts_v2(id), expires_at INTEGER NOT NULL);
INSERT INTO account_sessions_v2 SELECT * FROM account_sessions;
CREATE TABLE account_invitations_v2 (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL UNIQUE REFERENCES accounts_v2(id), expires_at INTEGER NOT NULL);
INSERT INTO account_invitations_v2 SELECT * FROM account_invitations;
CREATE TABLE account_usage_v2 (account_id TEXT NOT NULL REFERENCES accounts_v2(id),period TEXT NOT NULL,used INTEGER NOT NULL CHECK(used >= 0),PRIMARY KEY(account_id,period));
INSERT INTO account_usage_v2 SELECT * FROM account_usage;
CREATE TABLE usage_reservations_v2 (id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts_v2(id),period TEXT NOT NULL,units INTEGER NOT NULL CHECK(units >= 0));
INSERT INTO usage_reservations_v2 SELECT 'default:'||id,account_id,period,units FROM usage_reservations;
DROP TABLE usage_reservations;
DROP TABLE account_usage;
DROP TABLE account_invitations;
DROP TABLE account_sessions;
DROP TABLE accounts;
ALTER TABLE accounts_v2 RENAME TO accounts;
ALTER TABLE account_sessions_v2 RENAME TO account_sessions;
ALTER TABLE account_invitations_v2 RENAME TO account_invitations;
ALTER TABLE account_usage_v2 RENAME TO account_usage;
ALTER TABLE usage_reservations_v2 RENAME TO usage_reservations;
CREATE INDEX account_sessions_user ON account_sessions(account_id);

CREATE TABLE assets_v2 (id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspace(id),mime TEXT NOT NULL,bytes INTEGER NOT NULL CHECK(bytes>=0),created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER)));
INSERT INTO assets_v2 SELECT id,'default',mime,bytes,created_at FROM assets;
DROP TABLE assets;
ALTER TABLE assets_v2 RENAME TO assets;
CREATE INDEX assets_workspace ON assets(workspace_id);
CREATE TABLE commands_v2 (id TEXT NOT NULL,workspace_id TEXT NOT NULL REFERENCES workspace(id),fingerprint TEXT NOT NULL,response TEXT NOT NULL CHECK(json_valid(response)),created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER)),PRIMARY KEY(workspace_id,id));
INSERT INTO commands_v2 SELECT id,'default',fingerprint,response,created_at FROM commands;
DROP TABLE commands;
ALTER TABLE commands_v2 RENAME TO commands;

DROP TRIGGER sync_products_insert;
DROP TRIGGER sync_products_update;
DROP TRIGGER sync_products_delete;
DROP TRIGGER sync_jobs_insert;
DROP TRIGGER sync_jobs_update;
DROP TRIGGER sync_jobs_delete;
DROP TRIGGER sync_workspace_insert;
DROP TRIGGER sync_workspace_update;
DROP TRIGGER sync_workspace_delete;
CREATE TABLE sync_clock_v2 (id INTEGER NOT NULL CHECK(id=1),workspace_id TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(workspace_id,id));
INSERT INTO sync_clock_v2 SELECT id,'default',revision FROM sync_clock;
CREATE TABLE sync_entities_v2 (workspace_id TEXT NOT NULL,kind TEXT NOT NULL,entity_id TEXT NOT NULL,revision INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(workspace_id,kind,entity_id));
INSERT INTO sync_entities_v2 SELECT 'default',kind,entity_id,revision,deleted FROM sync_entities;
DROP TABLE sync_entities;
DROP TABLE sync_clock;
ALTER TABLE sync_clock_v2 RENAME TO sync_clock;
ALTER TABLE sync_entities_v2 RENAME TO sync_entities;
CREATE INDEX sync_entities_revision ON sync_entities(workspace_id,revision);

CREATE TRIGGER sync_products_insert AFTER INSERT ON products BEGIN
 INSERT INTO sync_clock(id,workspace_id,revision) VALUES(1,NEW.workspace_id,1) ON CONFLICT(workspace_id,id) DO UPDATE SET revision=revision+1;
 INSERT INTO sync_entities(workspace_id,kind,entity_id,revision,deleted) VALUES(NEW.workspace_id,'product',NEW.id,(SELECT revision FROM sync_clock WHERE id=1 AND workspace_id=NEW.workspace_id),0)
 ON CONFLICT(workspace_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;

CREATE TRIGGER sync_products_update AFTER UPDATE ON products WHEN OLD.document IS NOT NEW.document OR OLD.code IS NOT NEW.code BEGIN
 INSERT INTO sync_clock(id,workspace_id,revision) VALUES(1,NEW.workspace_id,1) ON CONFLICT(workspace_id,id) DO UPDATE SET revision=revision+1;
 INSERT INTO sync_entities(workspace_id,kind,entity_id,revision,deleted) VALUES(NEW.workspace_id,'product',NEW.id,(SELECT revision FROM sync_clock WHERE id=1 AND workspace_id=NEW.workspace_id),0)
 ON CONFLICT(workspace_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;

CREATE TRIGGER sync_products_delete AFTER DELETE ON products BEGIN
 INSERT INTO sync_clock(id,workspace_id,revision) VALUES(1,OLD.workspace_id,1) ON CONFLICT(workspace_id,id) DO UPDATE SET revision=revision+1;
 INSERT INTO sync_entities(workspace_id,kind,entity_id,revision,deleted) VALUES(OLD.workspace_id,'product',OLD.id,(SELECT revision FROM sync_clock WHERE id=1 AND workspace_id=OLD.workspace_id),1)
 ON CONFLICT(workspace_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;

CREATE TRIGGER sync_jobs_insert AFTER INSERT ON jobs BEGIN
 INSERT INTO sync_clock(id,workspace_id,revision) VALUES(1,NEW.workspace_id,1) ON CONFLICT(workspace_id,id) DO UPDATE SET revision=revision+1;
 INSERT INTO sync_entities(workspace_id,kind,entity_id,revision,deleted) VALUES(NEW.workspace_id,'job',NEW.id,(SELECT revision FROM sync_clock WHERE id=1 AND workspace_id=NEW.workspace_id),0)
 ON CONFLICT(workspace_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;

CREATE TRIGGER sync_jobs_update AFTER UPDATE ON jobs WHEN OLD.payload IS NOT NEW.payload OR OLD.status IS NOT NEW.status OR OLD.stage IS NOT NEW.stage OR OLD.remote_id IS NOT NEW.remote_id BEGIN
 INSERT INTO sync_clock(id,workspace_id,revision) VALUES(1,NEW.workspace_id,1) ON CONFLICT(workspace_id,id) DO UPDATE SET revision=revision+1;
 INSERT INTO sync_entities(workspace_id,kind,entity_id,revision,deleted) VALUES(NEW.workspace_id,'job',NEW.id,(SELECT revision FROM sync_clock WHERE id=1 AND workspace_id=NEW.workspace_id),0)
 ON CONFLICT(workspace_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;

CREATE TRIGGER sync_jobs_delete AFTER DELETE ON jobs BEGIN
 INSERT INTO sync_clock(id,workspace_id,revision) VALUES(1,OLD.workspace_id,1) ON CONFLICT(workspace_id,id) DO UPDATE SET revision=revision+1;
 INSERT INTO sync_entities(workspace_id,kind,entity_id,revision,deleted) VALUES(OLD.workspace_id,'job',OLD.id,(SELECT revision FROM sync_clock WHERE id=1 AND workspace_id=OLD.workspace_id),1)
 ON CONFLICT(workspace_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;

CREATE TRIGGER sync_workspace_insert AFTER INSERT ON workspace BEGIN
 INSERT INTO sync_clock(id,workspace_id,revision) VALUES(1,NEW.id,1) ON CONFLICT(workspace_id,id) DO UPDATE SET revision=revision+1;
 INSERT INTO sync_entities(workspace_id,kind,entity_id,revision,deleted) VALUES(NEW.id,'workspace',NEW.id,(SELECT revision FROM sync_clock WHERE id=1 AND workspace_id=NEW.id),0)
 ON CONFLICT(workspace_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;

CREATE TRIGGER sync_workspace_update AFTER UPDATE ON workspace WHEN OLD.document IS NOT NEW.document BEGIN
 INSERT INTO sync_clock(id,workspace_id,revision) VALUES(1,NEW.id,1) ON CONFLICT(workspace_id,id) DO UPDATE SET revision=revision+1;
 INSERT INTO sync_entities(workspace_id,kind,entity_id,revision,deleted) VALUES(NEW.id,'workspace',NEW.id,(SELECT revision FROM sync_clock WHERE id=1 AND workspace_id=NEW.id),0)
 ON CONFLICT(workspace_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;

CREATE TRIGGER sync_workspace_delete AFTER DELETE ON workspace BEGIN
 INSERT INTO sync_clock(id,workspace_id,revision) VALUES(1,OLD.id,1) ON CONFLICT(workspace_id,id) DO UPDATE SET revision=revision+1;
 INSERT INTO sync_entities(workspace_id,kind,entity_id,revision,deleted) VALUES(OLD.id,'workspace',OLD.id,(SELECT revision FROM sync_clock WHERE id=1 AND workspace_id=OLD.id),1)
 ON CONFLICT(workspace_id,kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
