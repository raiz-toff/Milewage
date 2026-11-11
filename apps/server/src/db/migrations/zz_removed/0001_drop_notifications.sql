-- The notifications module (the in-app inbox and its switches) was removed. Its two tables go,
-- their index with them. notifications/ stays so databases that applied its 0001 still start.
-- This file is not in notifications/: folders run in name order, and progress/0002 and
-- schedule/0002 still delete inbox rows and drop switch columns. On a new database and on an
-- upgrade from 0.2.0 they must run before this, and `zz_` sorts after every module folder.
DROP TABLE notifications;
DROP TABLE notification_prefs;
