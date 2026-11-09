-- ADR 0002: the owner's switch for the Help pages in the web app and the help links on screens.
-- Owners who already have settings get Help on, as new owners do.
ALTER TABLE settings ADD COLUMN help_enabled INTEGER NOT NULL DEFAULT 1 CHECK (help_enabled IN (0,1));
