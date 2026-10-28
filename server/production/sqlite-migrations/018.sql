-- Promote the current owner's service preferences to workspace settings.
-- Editor overrides must never become workspace-wide defaults.
UPDATE workspace SET document=json_set(document,
 '$.settings.promptModel',COALESCE((SELECT json_extract(s.document,'$.promptModel')
   FROM member_generation_settings s JOIN workspace_members m
   ON m.workspace_id=s.workspace_id AND m.account_id=s.account_id
   WHERE s.workspace_id=workspace.id AND m.role='owner'),json_extract(document,'$.settings.promptModel')),
 '$.settings.promptProvider',COALESCE((SELECT json_extract(s.document,'$.promptProvider')
   FROM member_generation_settings s JOIN workspace_members m
   ON m.workspace_id=s.workspace_id AND m.account_id=s.account_id
   WHERE s.workspace_id=workspace.id AND m.role='owner'),json_extract(document,'$.settings.promptProvider')),
 '$.settings.baseUrl',COALESCE((SELECT json_extract(s.document,'$.baseUrl')
   FROM member_generation_settings s JOIN workspace_members m
   ON m.workspace_id=s.workspace_id AND m.account_id=s.account_id
   WHERE s.workspace_id=workspace.id AND m.role='owner'),json_extract(document,'$.settings.baseUrl')),
 '$.settings.mode','live');
UPDATE member_generation_settings SET document=json_remove(document,
 '$.promptModel','$.promptProvider','$.baseUrl','$.mode');
