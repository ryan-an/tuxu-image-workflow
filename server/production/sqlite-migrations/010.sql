-- Replace submission counts with successful image counts, including existing jobs.
-- Job IDs remain in the ledger after workflow deletion to preserve monthly usage.
DROP TABLE usage_reservations;
DELETE FROM account_usage;
CREATE TABLE account_image_usage (
 job_id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES accounts(id),
 period TEXT NOT NULL
);
INSERT INTO account_image_usage(job_id,account_id,period)
 SELECT j.id,a.id,strftime('%Y-%m',(COALESCE(json_extract(j.payload,'$.finishedAt'),j.created_at)/1000.0),'unixepoch','+8 hours')
 FROM jobs j JOIN accounts a
 ON a.id=COALESCE(json_extract(j.payload,'$.lastRetriedBy.id'),json_extract(j.payload,'$.createdBy.id')) AND a.workspace_id=j.workspace_id
 WHERE j.kind='image' AND j.status='completed';
INSERT INTO account_usage(account_id,period,used)
 SELECT account_id,period,COUNT(*) FROM account_image_usage GROUP BY account_id,period;
