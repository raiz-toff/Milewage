-- 18 section 4.2: the driver's overrides of the built-in platforms and the custom ones.
CREATE TABLE platform_settings (
  user_id             INTEGER NOT NULL REFERENCES users(id),
  slug                TEXT    NOT NULL CHECK (slug GLOB '[a-z0-9_]*' AND length(slug) BETWEEN 1 AND 32),
  label               TEXT    NOT NULL,
  custom              INTEGER NOT NULL DEFAULT 0 CHECK (custom IN (0,1)),
  color               TEXT    CHECK (color IS NULL OR color GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
  emoji               TEXT,
  active              INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort                INTEGER NOT NULL DEFAULT 0,
  hourly_target_cents INTEGER CHECK (hourly_target_cents IS NULL OR hourly_target_cents >= 0),
  PRIMARY KEY (user_id, slug)
);
