-- Dashboard "Finish setting up": the JSON list of checklist steps the driver has finished or
-- skipped. A step stays done once it is listed, so deleting a goal later does not reopen setup
-- (owner, 2026-11-08). Null: none yet.
ALTER TABLE settings ADD COLUMN setup_done TEXT;
