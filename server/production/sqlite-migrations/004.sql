-- Analyses now cover selected cards, so different cards can run independently.
DROP INDEX jobs_active_suite;
CREATE INDEX jobs_active_analysis ON jobs(workspace_id,product_id,status)
 WHERE kind='prompt-set';

CREATE TRIGGER jobs_analysis_scope_insert BEFORE INSERT ON jobs
WHEN NEW.kind='prompt-set' AND NEW.status IN ('queued','running')
BEGIN
 SELECT RAISE(ABORT, 'card already has an active analysis') WHERE EXISTS (
  SELECT 1 FROM jobs j, json_each(j.payload,'$.taskIds') existing,
   json_each(NEW.payload,'$.taskIds') requested
  WHERE j.workspace_id=NEW.workspace_id AND j.product_id=NEW.product_id
   AND j.kind='prompt-set' AND j.status IN ('queued','running')
   AND existing.value=requested.value
 );
END;

CREATE TRIGGER jobs_analysis_scope_update BEFORE UPDATE OF status,payload ON jobs
WHEN NEW.kind='prompt-set' AND NEW.status IN ('queued','running')
BEGIN
 SELECT RAISE(ABORT, 'card already has an active analysis') WHERE EXISTS (
  SELECT 1 FROM jobs j, json_each(j.payload,'$.taskIds') existing,
   json_each(NEW.payload,'$.taskIds') requested
  WHERE j.id<>NEW.id AND j.workspace_id=NEW.workspace_id AND j.product_id=NEW.product_id
   AND j.kind='prompt-set' AND j.status IN ('queued','running')
   AND existing.value=requested.value
 );
END;
