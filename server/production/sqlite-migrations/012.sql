-- Joining a workspace requires consent independently of temporarily enabling access.
ALTER TABLE workspace_members ADD COLUMN accepted_at INTEGER;
UPDATE workspace_members SET accepted_at=created_at
 WHERE status IN ('active','disabled','deleted') AND EXISTS (
  SELECT 1 FROM accounts a WHERE a.id=workspace_members.account_id AND a.password_hash IS NOT NULL
 );
