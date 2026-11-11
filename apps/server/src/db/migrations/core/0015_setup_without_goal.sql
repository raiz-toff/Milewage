-- The goals module was removed, and with it the "Set a weekly goal" step of "Finish setting up".
-- A driver who finished or skipped that step had it listed in setup_done; it is taken out.
UPDATE settings
SET setup_done = (SELECT json_group_array(value) FROM json_each(settings.setup_done) WHERE value <> 'goal')
WHERE setup_done IS NOT NULL
  AND EXISTS (SELECT 1 FROM json_each(settings.setup_done) WHERE value = 'goal');
