-- MileWage 0.1.0 had the assistant endpoint off by default; 0.2.0 turned it on. A server that
-- already had its owner before the sign-in tables arrived (mcp 0003, new in 0.2.0) and never made
-- an assistant code keeps it off, until MILEWAGE_MODULE_MCP=1 or settings.json turns it on.
-- A new server (no owner yet when this runs) and one already connected stay on.
CREATE TABLE mcp_kept_off (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  since INTEGER NOT NULL
);
INSERT INTO mcp_kept_off (id, since)
SELECT 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM mcp_tokens)
  AND EXISTS (
    SELECT 1 FROM users
    WHERE created_at < (
      SELECT applied_at FROM schema_migrations WHERE module = 'mcp' AND id = '0003_oauth'
    )
  );
