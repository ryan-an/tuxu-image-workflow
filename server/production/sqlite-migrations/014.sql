CREATE TABLE sheet_imports (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace(id),
 document TEXT NOT NULL CHECK(json_valid(document)), expires_at INTEGER NOT NULL
);
CREATE INDEX sheet_imports_expiry ON sheet_imports(workspace_id, expires_at);
