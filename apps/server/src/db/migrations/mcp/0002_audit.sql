-- One row per write tool call (plan 26 section 3.7): what an assistant changed, with which token.
CREATE TABLE mcp_audit (
  id       INTEGER PRIMARY KEY,
  user_id  INTEGER NOT NULL REFERENCES users(id),
  token_id INTEGER NOT NULL REFERENCES mcp_tokens(id),
  at       INTEGER NOT NULL,
  tool     TEXT    NOT NULL,
  outcome  TEXT    NOT NULL,
  target   TEXT,
  args     TEXT    NOT NULL
);
CREATE INDEX mcp_audit_user_at ON mcp_audit (user_id, at);
