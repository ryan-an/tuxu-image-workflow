ALTER TABLE workspace ADD COLUMN prompt_credential TEXT;
UPDATE workspace SET document = json_set(
 document,
 '$.settings.promptProvider', 'doubao',
 '$.settings.promptModel', CASE
  WHEN json_extract(document, '$.settings.promptModel') LIKE 'doubao-%'
    OR json_extract(document, '$.settings.promptModel') LIKE 'ep-%'
  THEN json_extract(document, '$.settings.promptModel')
  ELSE 'doubao-seed-2-1-pro-260915'
 END
);
