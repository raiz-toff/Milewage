-- The progress module (XP, level, streak, weekly challenges, badges) was removed. Its tables go,
-- and so do the inbox rows and the streak switch only it used. This folder stays so databases that
-- applied 0001 still start.
DELETE FROM notifications WHERE kind IN ('badge', 'challenge', 'level_up', 'streak_freeze', 'streak_risk');
ALTER TABLE notification_prefs DROP COLUMN streak;
DROP TABLE badge_unlocks;
DROP TABLE progress_state;
