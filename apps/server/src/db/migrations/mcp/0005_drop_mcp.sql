-- The mcp module (the AI assistant endpoint, its access codes, sign-in connections and audit log)
-- was removed. Its tables go, their indexes with them; children before the tables they point to.
-- This folder stays so databases that applied 0001 to 0004 still start.
DROP TABLE mcp_audit;
DROP TABLE mcp_tokens;
DROP TABLE mcp_clients;
DROP TABLE mcp_kept_off;
