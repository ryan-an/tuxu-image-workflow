-- Model preferences belong to a person in one workspace; credentials stay shared.
CREATE TABLE member_generation_settings (
 workspace_id TEXT NOT NULL,
 account_id TEXT NOT NULL,
 document TEXT NOT NULL CHECK(json_valid(document)),
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,account_id),
 FOREIGN KEY(workspace_id,account_id) REFERENCES workspace_members(workspace_id,account_id) ON DELETE CASCADE
);
INSERT INTO member_generation_settings(workspace_id,account_id,document,updated_at)
 SELECT m.workspace_id,m.account_id,COALESCE(json_extract(w.document,'$.settings'),'{}'),
 CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM workspace_members m JOIN workspace w ON w.id=m.workspace_id;
