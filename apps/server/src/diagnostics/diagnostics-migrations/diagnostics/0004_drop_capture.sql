-- diagnostics.db: the capture module (time-boxed dense recording, annotations and anonymized replay)
-- was removed. Its three tables go, with every recorded fix and note; they were never files on the
-- volume and never in a backup. 0003_capture stays so a file that applied it still opens.
DROP TABLE capture_annotations;
DROP TABLE capture_fixes;
DROP TABLE capture_sessions;
-- The events' capture session id, always empty without the module.
ALTER TABLE diag_events DROP COLUMN capture_id;
-- Stored events the schema no longer accepts: the sessions' own log and the module's switch.
DELETE FROM diag_events WHERE kind = 'capture.state';
UPDATE diag_events SET data = json_remove(data, '$.modules.capture')
  WHERE kind IN ('server.start', 'settings.applied');
