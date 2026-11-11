-- Whether the driver pays income tax by instalments in a tax year. A tax office asks for
-- instalments only from some people, so the instalment dates are shown and reminded only to a
-- driver who says so. Off unless chosen.
ALTER TABLE tax_years ADD COLUMN pays_instalments INTEGER NOT NULL DEFAULT 0 CHECK (pays_instalments IN (0,1));
