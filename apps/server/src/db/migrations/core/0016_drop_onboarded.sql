-- The web's setup wizard was removed. settings.onboarded_at only said whether it was finished,
-- and nothing reads it now. work_kinds and setup_done stay.
ALTER TABLE settings DROP COLUMN onboarded_at;
