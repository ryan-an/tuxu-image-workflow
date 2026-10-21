CREATE INDEX jobs_history_time ON jobs(workspace_id, COALESCE(json_extract(payload,'$.createdAt'),created_at) DESC, id DESC);
