-- Replace the former manual platform-check state without resubmitting jobs.
-- Saved platform IDs remain queryable; jobs without an ID become retryable failures.
UPDATE jobs SET
 status=CASE WHEN remote_id IS NOT NULL THEN 'queued' ELSE 'failed' END,
 stage=CASE WHEN remote_id IS NOT NULL THEN 'polling' ELSE 'pending' END,
 owner=NULL,lease_until=NULL,
 due_at=CAST(unixepoch('subsec')*1000 AS INTEGER),
 payload=json_set(
   CASE WHEN remote_id IS NOT NULL THEN json_remove(payload,'$.finishedAt')
     ELSE json_set(payload,'$.finishedAt',COALESCE(json_extract(payload,'$.finishedAt'),CAST(unixepoch('subsec')*1000 AS INTEGER))) END,
   '$.status',CASE WHEN remote_id IS NOT NULL THEN 'queued' ELSE 'failed' END,
   '$.stage',CASE WHEN remote_id IS NOT NULL THEN 'polling' ELSE 'pending' END,
   '$.error',CASE WHEN remote_id IS NOT NULL THEN ''
     WHEN kind='prompt-set' THEN '提示词分析中断，请重试'
     ELSE '图片提交中断，未取得平台任务 ID，请重试' END)
WHERE status='interrupted';

UPDATE jobs SET stage='pending',
 payload=json_set(payload,'$.stage','pending','$.error',
   CASE WHEN kind='prompt-set' THEN '提示词分析未完成，请重试'
     ELSE '图片提交未完成，未取得平台任务 ID，请重试' END)
WHERE status IN ('failed','cancelled') AND remote_id IS NULL
 AND stage IN ('submitting','analyzing');
