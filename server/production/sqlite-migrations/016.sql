-- Old global cooldowns lack credential ownership and must not block other keys.
DROP TABLE model_cooldowns;
CREATE TABLE model_cooldowns (
 workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
 credential_version TEXT NOT NULL,
 provider TEXT NOT NULL,model TEXT NOT NULL,retry_until INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,credential_version,provider,model)
);
