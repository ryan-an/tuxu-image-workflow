-- One latest revision per entity: bounded by workspace size, including tombstones.
CREATE TABLE sync_clock (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
INSERT INTO sync_clock VALUES(1,0);
CREATE TABLE sync_entities (kind TEXT NOT NULL, entity_id TEXT NOT NULL, revision INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(kind,entity_id));
CREATE INDEX sync_entities_revision ON sync_entities(revision);
CREATE TRIGGER sync_products_insert AFTER INSERT ON products BEGIN
 UPDATE sync_clock SET revision=revision+1 WHERE id=1;
 INSERT INTO sync_entities(kind,entity_id,revision,deleted) VALUES('product',NEW.id,(SELECT revision FROM sync_clock WHERE id=1),0)
 ON CONFLICT(kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
CREATE TRIGGER sync_products_update AFTER UPDATE ON products WHEN OLD.document IS NOT NEW.document OR OLD.code IS NOT NEW.code BEGIN
 UPDATE sync_clock SET revision=revision+1 WHERE id=1;
 INSERT INTO sync_entities(kind,entity_id,revision,deleted) VALUES('product',NEW.id,(SELECT revision FROM sync_clock WHERE id=1),0)
 ON CONFLICT(kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
CREATE TRIGGER sync_products_delete AFTER DELETE ON products BEGIN
 UPDATE sync_clock SET revision=revision+1 WHERE id=1;
 INSERT INTO sync_entities(kind,entity_id,revision,deleted) VALUES('product',OLD.id,(SELECT revision FROM sync_clock WHERE id=1),1)
 ON CONFLICT(kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
CREATE TRIGGER sync_jobs_insert AFTER INSERT ON jobs BEGIN
 UPDATE sync_clock SET revision=revision+1 WHERE id=1;
 INSERT INTO sync_entities(kind,entity_id,revision,deleted) VALUES('job',NEW.id,(SELECT revision FROM sync_clock WHERE id=1),0)
 ON CONFLICT(kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
CREATE TRIGGER sync_jobs_update AFTER UPDATE ON jobs WHEN OLD.payload IS NOT NEW.payload OR OLD.status IS NOT NEW.status OR OLD.stage IS NOT NEW.stage OR OLD.remote_id IS NOT NEW.remote_id BEGIN
 UPDATE sync_clock SET revision=revision+1 WHERE id=1;
 INSERT INTO sync_entities(kind,entity_id,revision,deleted) VALUES('job',NEW.id,(SELECT revision FROM sync_clock WHERE id=1),0)
 ON CONFLICT(kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
CREATE TRIGGER sync_jobs_delete AFTER DELETE ON jobs BEGIN
 UPDATE sync_clock SET revision=revision+1 WHERE id=1;
 INSERT INTO sync_entities(kind,entity_id,revision,deleted) VALUES('job',OLD.id,(SELECT revision FROM sync_clock WHERE id=1),1)
 ON CONFLICT(kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
CREATE TRIGGER sync_workspace_insert AFTER INSERT ON workspace BEGIN
 UPDATE sync_clock SET revision=revision+1 WHERE id=1;
 INSERT INTO sync_entities(kind,entity_id,revision,deleted) VALUES('workspace',NEW.id,(SELECT revision FROM sync_clock WHERE id=1),0)
 ON CONFLICT(kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
CREATE TRIGGER sync_workspace_update AFTER UPDATE ON workspace WHEN OLD.document IS NOT NEW.document BEGIN
 UPDATE sync_clock SET revision=revision+1 WHERE id=1;
 INSERT INTO sync_entities(kind,entity_id,revision,deleted) VALUES('workspace',NEW.id,(SELECT revision FROM sync_clock WHERE id=1),0)
 ON CONFLICT(kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
CREATE TRIGGER sync_workspace_delete AFTER DELETE ON workspace BEGIN
 UPDATE sync_clock SET revision=revision+1 WHERE id=1;
 INSERT INTO sync_entities(kind,entity_id,revision,deleted) VALUES('workspace',OLD.id,(SELECT revision FROM sync_clock WHERE id=1),1)
 ON CONFLICT(kind,entity_id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted;
END;
