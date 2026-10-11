CREATE TABLE workspace (
 id TEXT PRIMARY KEY, document TEXT NOT NULL CHECK(json_valid(document)), credential TEXT,
 updated_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
);
CREATE TABLE products (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace(id),
 code TEXT NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)), UNIQUE(workspace_id, code)
);
CREATE TABLE jobs (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace(id),
 product_id TEXT NOT NULL REFERENCES products(id), task_id TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('prompt-set','image')),
 status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled','interrupted')),
 stage TEXT NOT NULL DEFAULT 'pending', depends_on TEXT REFERENCES jobs(id), remote_id TEXT,
 due_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER)), lease_until INTEGER, owner TEXT,
 payload TEXT NOT NULL CHECK(json_valid(payload)), created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
);
CREATE INDEX jobs_dispatch ON jobs(workspace_id,status,due_at);
CREATE UNIQUE INDEX jobs_active_image ON jobs(workspace_id,task_id)
 WHERE kind='image' AND status IN ('queued','running','interrupted');
CREATE UNIQUE INDEX jobs_active_suite ON jobs(workspace_id,product_id)
 WHERE kind='prompt-set' AND status IN ('queued','running','interrupted');
CREATE TABLE job_attempts (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), stage TEXT NOT NULL,
 outcome TEXT NOT NULL, error TEXT, started_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER)), finished_at INTEGER
);
CREATE TABLE assets (
 id TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes >= 0), created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
);
CREATE TABLE commands (
 id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response TEXT NOT NULL CHECK(json_valid(response)), created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
);
