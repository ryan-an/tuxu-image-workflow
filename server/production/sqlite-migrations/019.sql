-- Initialize existing workspaces once; subsequent owner selections are retained.
UPDATE workspace SET document=json_set(document,
 '$.settings.promptProvider','doubao',
 '$.settings.promptModel','doubao-seed-2-1-pro-260915')
WHERE json_extract(document,'$.settings.promptProvider') IS NOT 'doubao'
 OR json_extract(document,'$.settings.promptModel') IS NOT 'doubao-seed-2-1-pro-260915';
