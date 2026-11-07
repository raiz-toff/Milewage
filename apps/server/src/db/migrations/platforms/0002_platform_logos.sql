-- Plan 25 section 7: a logo image the driver uploaded for one of their platforms (built-in or
-- custom). Small (256 KB at most), so it lives in the database: every backup and restore carries it
-- with no files on the side (https://www.sqlite.org/intern-v-extern-blob.html).
CREATE TABLE platform_logos (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  slug       TEXT    NOT NULL CHECK (slug GLOB '[a-z0-9_]*' AND length(slug) BETWEEN 1 AND 32),
  mime       TEXT    NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  bytes      BLOB    NOT NULL CHECK (length(bytes) BETWEEN 1 AND 262144),
  sha256     TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, slug)
);
