-- System access is independent of workspace membership and ownership.
ALTER TABLE accounts ADD COLUMN system_role TEXT NOT NULL DEFAULT 'user'
 CHECK(system_role IN ('user','super_admin'));
UPDATE accounts SET system_role='super_admin' WHERE id='owner';

CREATE TABLE admin_audit_logs (
 id TEXT PRIMARY KEY,
 created_at INTEGER NOT NULL,
 actor_id TEXT NOT NULL,
 action TEXT NOT NULL,
 target_account_id TEXT,
 workspace_id TEXT,
 result TEXT NOT NULL CHECK(result IN ('success','failure')),
 request_id TEXT NOT NULL,
 changes TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(changes)),
 error_code TEXT
);
CREATE INDEX admin_audit_created ON admin_audit_logs(created_at DESC,id);
CREATE INDEX admin_audit_target ON admin_audit_logs(target_account_id,workspace_id,created_at DESC);
CREATE INDEX admin_audit_request ON admin_audit_logs(request_id,result);

-- Administrator preferences must not create implicit workspace memberships.
CREATE TABLE admin_generation_settings (
 workspace_id TEXT NOT NULL REFERENCES workspace(id),
 account_id TEXT NOT NULL REFERENCES accounts(id),
 document TEXT NOT NULL CHECK(json_valid(document)),
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,account_id)
);

-- Management-mode images have a separate source and never consume member quota.
CREATE TABLE admin_image_usage (
 job_id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspace(id),
 account_id TEXT NOT NULL REFERENCES accounts(id),
 period TEXT NOT NULL
);
CREATE TABLE admin_usage (
 workspace_id TEXT NOT NULL REFERENCES workspace(id),
 account_id TEXT NOT NULL REFERENCES accounts(id),
 period TEXT NOT NULL,
 used INTEGER NOT NULL CHECK(used>=0),
 PRIMARY KEY(workspace_id,account_id,period)
);
