-- Initialize both inherited defaults and saved personal models once.
-- gpt-image-2 requires auto quality; retain sizes and queued job snapshots.
UPDATE workspace SET document=json_set(document,
 '$.settings.imageModel','gpt-image-2',
 '$.settings.quality','auto')
WHERE json_extract(document,'$.settings.imageModel') IS NOT 'gpt-image-2'
 OR json_extract(document,'$.settings.quality') IS NOT 'auto';

UPDATE member_generation_settings SET document=json_set(document,
 '$.imageModel','gpt-image-2',
 '$.quality','auto')
WHERE json_extract(document,'$.imageModel') IS NOT 'gpt-image-2'
 OR json_extract(document,'$.quality') IS NOT 'auto';
