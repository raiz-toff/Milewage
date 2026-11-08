-- Assistant access tokens for the MCP endpoint (plan 26 section 3.2). Only the SHA-256 hash is kept.
CREATE TABLE mcp_tokens (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  name         TEXT    NOT NULL,
  scope        TEXT    NOT NULL CHECK (scope IN ('read','write')),
  token_hash   TEXT    NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER,
  last_used_at INTEGER,
  revoked_at   INTEGER
);
