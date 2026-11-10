import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { ServerRouteHost } from '../app';
import { hashToken, type Authenticator } from '../auth/authenticator';
import type { Db } from '../db';
import { ProblemError } from '../errors';
import { idParams, str, strictObject } from '../routes/util';

export type McpScope = 'read' | 'write';
export interface McpTokenRow {
  id: number;
  userId: number;
  name: string;
  scope: McpScope;
  tokenHash: string;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  /** Set when an assistant connected by signing in (`oauth.ts`); null for a code made by hand. */
  clientId: string | null;
  /** A signed-in connection lasts while its refresh code does; `expiresAt` is then the access code's. */
  refreshExpiresAt: number | null;
}

/** At most this many tokens that are neither revoked nor expired (plan 26 section 3.2). */
export const MAX_LIVE_TOKENS = 20;
const DAY = 24 * 60 * 60 * 1000;
/** `mwa_` plus 43 base64url characters (256 random bits), like `mwd_`, so secret scanners can find one. */
export const TOKEN_PATTERN = /^mwa_[A-Za-z0-9_-]{43}$/;
export const newAssistantToken = () => `mwa_${randomBytes(32).toString('base64url')}`;

const COLUMNS =
  'id, user_id AS userId, name, scope, token_hash AS tokenHash, created_at AS createdAt, expires_at AS expiresAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt, client_id AS clientId, refresh_expires_at AS refreshExpiresAt';

/** Not revoked, and either code still good: the access code, or a signed-in connection's refresh code. */
export const LIVE_SQL =
  'revoked_at IS NULL AND (expires_at IS NULL OR expires_at > @at OR refresh_expires_at > @at)';

/** Assistant access tokens (module `mcp`). Only the SHA-256 hash of a token is stored. */
export function createMcpTokenRepository(db: Db) {
  const find = (userId: number, id: number) =>
    db.prepare(`SELECT ${COLUMNS} FROM mcp_tokens WHERE user_id = ? AND id = ?`).get(userId, id) as
      McpTokenRow | undefined;
  return {
    find,
    list: (userId: number) =>
      db
        .prepare(`SELECT ${COLUMNS} FROM mcp_tokens WHERE user_id = ? ORDER BY id DESC`)
        .all(userId) as McpTokenRow[],
    live: (userId: number, at: number) =>
      db
        .prepare(`SELECT count(*) FROM mcp_tokens WHERE user_id = @userId AND ${LIVE_SQL}`)
        .pluck()
        .get({ userId, at }) as number,
    create(
      r: Pick<McpTokenRow, 'userId' | 'name' | 'scope' | 'tokenHash' | 'createdAt' | 'expiresAt'>,
    ) {
      const id = db
        .prepare(
          'INSERT INTO mcp_tokens (user_id, name, scope, token_hash, created_at, expires_at) VALUES (@userId, @name, @scope, @tokenHash, @createdAt, @expiresAt)',
        )
        .run(r).lastInsertRowid;
      return find(r.userId, Number(id))!;
    },
    /** The row for a presented token, compared in constant time after the indexed lookup. */
    byToken(token: string): McpTokenRow | undefined {
      const hash = hashToken(token);
      const row = db.prepare(`SELECT ${COLUMNS} FROM mcp_tokens WHERE token_hash = ?`).get(hash) as
        McpTokenRow | undefined;
      if (!row) return undefined;
      const same = timingSafeEqual(Buffer.from(row.tokenHash, 'hex'), Buffer.from(hash, 'hex'));
      return same ? row : undefined;
    },
    revoke: (userId: number, id: number, at: number) =>
      void db
        .prepare(
          'UPDATE mcp_tokens SET revoked_at = ? WHERE user_id = ? AND id = ? AND revoked_at IS NULL',
        )
        .run(at, userId, id),
    used: (id: number, at: number) =>
      void db.prepare('UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?').run(at, id),
  };
}

export const tokenView = (t: McpTokenRow) => ({
  id: t.id,
  name: t.name,
  scope: t.scope,
  /** `sign_in`: the assistant connected through the browser; `code`: a code made on the page. */
  kind: t.clientId === null ? ('code' as const) : ('sign_in' as const),
  created_at: t.createdAt,
  // A signed-in connection ends when its refresh code does; its access code renews every hour.
  expires_at: t.clientId === null ? t.expiresAt : t.refreshExpiresAt,
  last_used_at: t.lastUsedAt,
  revoked_at: t.revokedAt,
});

const createBody = strictObject(
  {
    name: str(1, 64),
    scope: { enum: ['read', 'write'] },
    expires_in_days: { enum: [30, 90, 365, null] },
  },
  ['name', 'scope'],
);

/** `GET/POST /mcp/tokens`, `DELETE /mcp/tokens/{id}`: web session only (plan 26 section 3.2). */
export function mcpTokenRoutes({
  db,
  now,
  authn,
}: {
  db: Db;
  now: () => number;
  authn: Authenticator;
}) {
  return ({ app }: ServerRouteHost) => {
    const repo = createMcpTokenRepository(db);

    app.get('/mcp/tokens', async (req) =>
      repo.list(authn.authenticate(req, 'S').userId).map(tokenView),
    );

    app.post('/mcp/tokens', { schema: { body: createBody } }, async (req, reply) => {
      const { userId } = authn.authenticate(req, 'S');
      const b = req.body as { name: string; scope: McpScope; expires_in_days?: number | null };
      const at = now();
      if (repo.live(userId, at) >= MAX_LIVE_TOKENS) {
        throw new ProblemError('validation_failed', 'Too many tokens.', [
          { path: '/', message: `at most ${MAX_LIVE_TOKENS} tokens; revoke one first` },
        ]);
      }
      const days = b.expires_in_days === undefined ? 90 : b.expires_in_days;
      const token = newAssistantToken();
      const row = repo.create({
        userId,
        name: b.name.trim() || 'Assistant',
        scope: b.scope,
        tokenHash: hashToken(token),
        createdAt: at,
        expiresAt: days === null ? null : at + days * DAY,
      });
      // The only time the token itself leaves the server.
      return reply.status(201).send({ ...tokenView(row), token });
    });

    // What assistants changed, newest first (plan 26 section 3.9); the arguments stay on the server.
    const audit = db.prepare(
      'SELECT a.id, a.at, a.tool, a.outcome, a.target, a.token_id, t.name AS token_name FROM mcp_audit a JOIN mcp_tokens t ON t.id = a.token_id WHERE a.user_id = ? ORDER BY a.id DESC LIMIT 50',
    );
    app.get('/mcp/audit', async (req) => audit.all(authn.authenticate(req, 'S').userId));

    // A new secret for a code made by hand, when the old one is lost or seen by someone else. The
    // row stays (name, access, expiry and its audit rows); the old secret stops working at once.
    app.post('/mcp/tokens/:id/replace', { schema: { params: idParams } }, async (req) => {
      const { userId } = authn.authenticate(req, 'S');
      const { id } = req.params as { id: number };
      const row = repo.find(userId, id);
      if (!row) throw new ProblemError('not_found', 'No such token.');
      const at = now();
      if (row.clientId !== null) {
        throw new ProblemError(
          'validation_failed',
          'A signed-in assistant has no code to replace. Revoke it, then connect it again.',
        );
      }
      if (row.revokedAt !== null || (row.expiresAt !== null && row.expiresAt <= at)) {
        throw new ProblemError(
          'validation_failed',
          'This token is revoked or expired. Make a new one.',
        );
      }
      const token = newAssistantToken();
      db.prepare('UPDATE mcp_tokens SET token_hash = ?, last_used_at = NULL WHERE id = ?').run(
        hashToken(token),
        id,
      );
      return { ...tokenView(repo.find(userId, id)!), token };
    });

    app.delete('/mcp/tokens/:id', { schema: { params: idParams } }, async (req, reply) => {
      const { userId } = authn.authenticate(req, 'S');
      const { id } = req.params as { id: number };
      if (!repo.find(userId, id)) throw new ProblemError('not_found', 'No such token.');
      repo.revoke(userId, id, now());
      return reply.status(204).send();
    });
  };
}
