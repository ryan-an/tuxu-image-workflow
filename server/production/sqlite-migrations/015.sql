-- Separate execution lanes while preserving the existing image-submit setting.
UPDATE workspace SET document=json_set(document,
 '$.promptConcurrency',COALESCE(json_extract(document,'$.promptConcurrency'),15),
 '$.queryConcurrency',COALESCE(json_extract(document,'$.queryConcurrency'),8));
CREATE INDEX jobs_running_lanes ON jobs(status,kind,workspace_id,remote_id,lease_until);
CREATE TABLE scheduler_turns (
 workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
 lane TEXT NOT NULL,member_id TEXT NOT NULL,sequence INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,lane,member_id)
);
CREATE TABLE model_cooldowns (
 provider TEXT NOT NULL,model TEXT NOT NULL,retry_until INTEGER NOT NULL,
 PRIMARY KEY(provider,model)
);
