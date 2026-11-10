-- Assistants that connect by signing in (OAuth 2.1 with PKCE, as MCP clients expect). A client
-- registers itself (RFC 7591); the driver approves it in the browser. Its access token is an
-- ordinary mcp_tokens row, so the list, revoke and audit work the same; only hashes are kept.
CREATE TABLE mcp_clients (
  id            TEXT    PRIMARY KEY,
  name          TEXT    NOT NULL,
  redirect_uris TEXT    NOT NULL, -- JSON array of exact URIs
  created_at    INTEGER NOT NULL
);
ALTER TABLE mcp_tokens ADD COLUMN client_id TEXT REFERENCES mcp_clients(id);
ALTER TABLE mcp_tokens ADD COLUMN refresh_hash TEXT;
ALTER TABLE mcp_tokens ADD COLUMN refresh_expires_at INTEGER;
CREATE UNIQUE INDEX mcp_tokens_refresh_hash ON mcp_tokens (refresh_hash) WHERE refresh_hash IS NOT NULL;
