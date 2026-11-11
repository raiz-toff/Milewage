-- The schedule module (planned shifts, repeating templates, off days) was removed. Its tables go,
-- and so do the shift reminder inbox rows and the switch that only its planned shifts used. This
-- folder stays so databases that applied 0001 still start.
DELETE FROM notifications WHERE kind = 'shift_reminder';
ALTER TABLE notification_prefs DROP COLUMN shift_reminders;
DROP TABLE schedule_entries;
DROP TABLE schedule_off_days;
DROP TABLE schedule_templates;
