CREATE TABLE workspace_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX workspace_activity_page ON workspace_activity(workspace_id, id DESC);
