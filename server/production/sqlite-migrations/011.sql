ALTER TABLE workspace ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspace ADD COLUMN archived_at INTEGER;
UPDATE workspace SET created_at=COALESCE((SELECT MIN(created_at) FROM accounts WHERE workspace_id=workspace.id),updated_at);

CREATE TABLE accounts_v3 (
 id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE COLLATE NOCASE,display_name TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','active','disabled','deleted')),
 password_hash TEXT,created_at INTEGER NOT NULL
);
INSERT INTO accounts_v3 SELECT id,username,display_name,
 CASE WHEN status='disabled' THEN 'active' ELSE status END,password_hash,created_at FROM accounts;
CREATE TABLE workspace_members (
 workspace_id TEXT NOT NULL REFERENCES workspace(id),account_id TEXT NOT NULL REFERENCES accounts_v3(id),
 display_name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
 status TEXT NOT NULL CHECK(status IN ('pending','active','disabled','deleted')),
 monthly_limit INTEGER CHECK(monthly_limit IS NULL OR monthly_limit>=0),created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,account_id)
);
INSERT INTO workspace_members SELECT workspace_id,id,display_name,role,status,monthly_limit,created_at FROM accounts;
CREATE UNIQUE INDEX workspace_one_owner ON workspace_members(workspace_id) WHERE role='owner';
CREATE INDEX workspace_members_account ON workspace_members(account_id,status);
CREATE TABLE workspace_invitations (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspace(id),
 token_hash TEXT NOT NULL UNIQUE,account_id TEXT REFERENCES accounts_v3(id),
 role TEXT NOT NULL CHECK(role IN ('editor','viewer')),expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL
);
INSERT INTO workspace_invitations SELECT lower(hex(randomblob(16))),a.workspace_id,i.token_hash,a.id,a.role,i.expires_at,a.created_at
 FROM account_invitations i JOIN accounts a ON a.id=i.account_id WHERE a.role<>'owner';
CREATE UNIQUE INDEX workspace_invitation_target ON workspace_invitations(workspace_id,account_id) WHERE account_id IS NOT NULL;
CREATE TABLE account_sessions_v3(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts_v3(id),expires_at INTEGER NOT NULL);
INSERT INTO account_sessions_v3 SELECT * FROM account_sessions;
CREATE TABLE account_usage_v3 (
 workspace_id TEXT NOT NULL REFERENCES workspace(id),account_id TEXT NOT NULL REFERENCES accounts_v3(id),
 period TEXT NOT NULL,used INTEGER NOT NULL CHECK(used>=0),PRIMARY KEY(workspace_id,account_id,period)
);
INSERT INTO account_usage_v3 SELECT a.workspace_id,u.account_id,u.period,u.used FROM account_usage u JOIN accounts a ON a.id=u.account_id;
CREATE TABLE account_image_usage_v3 (
 job_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspace(id),
 account_id TEXT NOT NULL REFERENCES accounts_v3(id),period TEXT NOT NULL
);
INSERT INTO account_image_usage_v3 SELECT u.job_id,a.workspace_id,u.account_id,u.period FROM account_image_usage u JOIN accounts a ON a.id=u.account_id;
DROP TABLE account_invitations;
DROP TABLE account_sessions;
DROP TABLE account_usage;
DROP TABLE account_image_usage;
DROP TABLE accounts;
ALTER TABLE accounts_v3 RENAME TO accounts;
ALTER TABLE account_sessions_v3 RENAME TO account_sessions;
ALTER TABLE account_usage_v3 RENAME TO account_usage;
ALTER TABLE account_image_usage_v3 RENAME TO account_image_usage;
CREATE INDEX account_sessions_user ON account_sessions(account_id);
