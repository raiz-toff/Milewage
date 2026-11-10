import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { OAuthMetadata, OAuthProtectedResourceMetadata } from '@modelcontextprotocol/server';
import { API_PREFIX, type ServerRouteHost } from '../app';
import { hashToken, type Authenticator } from '../auth/authenticator';
import { FailureLimiter } from '../auth/limiter';
import type { Db } from '../db';
import { ProblemError } from '../errors';
import { checkConnection, MCP_PATH, mcpAddresses, type ConfiguredAddresses } from './address';
import {
  createMcpTokenRepository,
  LIVE_SQL,
  MAX_LIVE_TOKENS,
  newAssistantToken,
  type McpScope,
} from './tokens';

// Connecting an assistant by signing in, as MCP clients (Claude Code, Cursor, VS Code) expect:
// OAuth 2.1 authorization code with PKCE (S256 only), public clients that register themselves
// (RFC 7591), discovery by RFC 8414 and RFC 9728, refresh codes that rotate on each use. The
// driver approves on the web page `/oauth/authorize`; the access code is an `mcp_tokens` row, so
// Settings > AI assistants lists it, revokes it and shows its changes like a code made by hand.

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** Access codes last an hour; the client renews them with its refresh code. */
export const ACCESS_MS = 60 * MINUTE;
/** A connection unused for 90 days ends; each renewal starts the 90 days again. */
export const REFRESH_MS = 90 * DAY;
/** An authorization code is good for one minute and one use. */
const CODE_MS = MINUTE;
/** Registered clients kept at most; ones never approved are dropped first. */
const MAX_CLIENTS = 100;
const SCOPES: readonly McpScope[] = ['read', 'write'];
/** The web page that asks the driver (apps/web, `ConnectAssistant`). */
export const AUTHORIZE_PAGE = '/oauth/authorize';

const newRefresh = () => `mwr_${randomBytes(32).toString('base64url')}`;
const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
const sameText = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function authServerMetadata(origin: string): OAuthMetadata {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${AUTHORIZE_PAGE}`,
    token_endpoint: `${origin}${API_PREFIX}/oauth/token`,
    registration_endpoint: `${origin}${API_PREFIX}/oauth/register`,
    scopes_supported: [...SCOPES],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
  };
}

/**
 * A redirect URI a public client may register: https, http to this computer only (RFC 8252
 * section 7.3), or an app's own scheme such as `cursor://` (section 7.1). No fragment, no user.
 */
export function redirectAllowed(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 512) return false;
  const u = URL.parse(value);
  if (!u || u.hash || u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  // A private-use scheme; never one a browser would run or show.
  const scheme = u.protocol.slice(0, -1);
  return (
    /^[a-z][a-z0-9+.-]*$/.test(scheme) &&
    !['javascript', 'data', 'file', 'blob', 'about', 'vbscript', 'ftp', 'ws', 'wss'].includes(
      scheme,
    )
  );
}

interface Client {
  id: string;
  name: string;
  redirectUris: string[];
}
interface Pending {
  clientId: string;
  userId: number;
  redirectUri: string;
  challenge: string;
  scope: McpScope;
  expiresAt: number;
}
type Query = Record<string, string | undefined>;

/** An OAuth error answer (RFC 6749 section 5.2): plain JSON, not the problem model. */
const oauthError = (reply: FastifyReply, status: number, error: string, description: string) =>
  reply.status(status).send({ error, error_description: description });

/** Discovery documents and the endpoints of the sign-in connection. */
export function mcpOAuthRoutes({
  db,
  now,
  authn,
  config,
}: {
  db: Db;
  now: () => number;
  authn: Authenticator;
  config: ConfiguredAddresses;
}) {
  return ({ app, root }: ServerRouteHost) => {
    const { origin: originOf, mcpUrl: mcpUrlOf } = mcpAddresses(config);
    const tokens = createMcpTokenRepository(db);
    const codes = new Map<string, Pending>();
    const failures = new FailureLimiter(20, 15 * MINUTE, now);

    const clientOf = (id: string | undefined): Client | undefined => {
      if (!id) return undefined;
      const row = db
        .prepare('SELECT id, name, redirect_uris AS uris FROM mcp_clients WHERE id = ?')
        .get(id) as { id: string; name: string; uris: string } | undefined;
      return row && { id: row.id, name: row.name, redirectUris: JSON.parse(row.uris) as string[] };
    };

    // Discovery, at the origin where the standards put it.
    const sendJson = (reply: FastifyReply, body: object) =>
      reply
        .header('Access-Control-Allow-Origin', '*')
        .header('Cache-Control', 'no-cache')
        .send(body);
    root.get('/.well-known/oauth-authorization-server', async (req, reply) =>
      sendJson(reply, authServerMetadata(originOf(req))),
    );
    // Written out, not built by the SDK's helper: that one refuses http, and MileWage allows
    // http on the home network (plan 28 section 4.1).
    const resource = async (req: FastifyRequest, reply: FastifyReply) => {
      const body: OAuthProtectedResourceMetadata = {
        resource: mcpUrlOf(req),
        authorization_servers: [originOf(req)],
        scopes_supported: [...SCOPES],
        bearer_methods_supported: ['header'],
        resource_name: 'MileWage',
      };
      return sendJson(reply, body);
    };
    root.get('/.well-known/oauth-protected-resource', resource);
    root.get(`/.well-known/oauth-protected-resource${MCP_PATH}`, resource);

    // Settings › AI assistants › Test connection: what an assistant would be told, and why.
    app.get('/mcp/connection', async (req) => {
      authn.authenticate(req, 'S');
      const given = (req.query as Query).address ?? '';
      const address = URL.parse(given);
      if (!address || !['http:', 'https:'].includes(address.protocol)) {
        throw new ProblemError('validation_failed', 'Give the address the browser is on.', [
          { path: '/address', message: 'an http or https address' },
        ]);
      }
      return checkConnection(req, address, config);
    });

    // Dynamic client registration (RFC 7591): public clients only, no secret.
    app.post('/oauth/register', async (req, reply) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const uris = b.redirect_uris;
      if (!Array.isArray(uris) || uris.length === 0 || uris.length > 5) {
        return oauthError(reply, 400, 'invalid_redirect_uri', 'Give 1 to 5 redirect_uris.');
      }
      if (!uris.every(redirectAllowed)) {
        return oauthError(
          reply,
          400,
          'invalid_redirect_uri',
          'Redirect URIs must be https, http://localhost or an app scheme, with no fragment.',
        );
      }
      const method = b.token_endpoint_auth_method ?? 'none';
      if (method !== 'none') {
        return oauthError(
          reply,
          400,
          'invalid_client_metadata',
          'Only public clients are supported: token_endpoint_auth_method must be none.',
        );
      }
      const name =
        typeof b.client_name === 'string' && b.client_name.trim()
          ? b.client_name.trim().slice(0, 64)
          : 'AI assistant';
      const at = now();
      // Registration needs no sign-in, so drop clients nobody approved within a day, then cap.
      const unused = 'NOT EXISTS (SELECT 1 FROM mcp_tokens t WHERE t.client_id = mcp_clients.id)';
      db.prepare(`DELETE FROM mcp_clients WHERE created_at < ? AND ${unused}`).run(at - DAY);
      if ((db.prepare('SELECT count(*) FROM mcp_clients').pluck().get() as number) >= MAX_CLIENTS) {
        db.prepare(
          `DELETE FROM mcp_clients WHERE id IN (SELECT id FROM mcp_clients WHERE ${unused} ORDER BY created_at LIMIT 1)`,
        ).run();
      }
      if ((db.prepare('SELECT count(*) FROM mcp_clients').pluck().get() as number) >= MAX_CLIENTS) {
        return oauthError(
          reply,
          400,
          'invalid_client_metadata',
          'Too many assistants are registered.',
        );
      }
      const id = randomUUID();
      db.prepare(
        'INSERT INTO mcp_clients (id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)',
      ).run(id, name, JSON.stringify(uris), at);
      return reply.status(201).send({
        client_id: id,
        client_id_issued_at: Math.floor(at / 1000),
        client_name: name,
        redirect_uris: uris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      });
    });

    /**
     * Checks an authorization request from the web page. Until the client and its redirect URI
     * are known, a problem is shown on the page and nothing is sent to the redirect URI.
     */
    const check = (req: FastifyRequest, q: Query) => {
      const client = clientOf(q.client_id);
      if (!client) {
        throw new ProblemError(
          'validation_failed',
          'MileWage does not know this assistant. Start connecting again from the assistant.',
        );
      }
      if (!q.redirect_uri || !client.redirectUris.includes(q.redirect_uri)) {
        throw new ProblemError(
          'validation_failed',
          'The assistant gave a return address it did not register. Start connecting again.',
        );
      }
      const fault =
        q.response_type !== 'code'
          ? 'response_type must be code.'
          : !q.code_challenge || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge)
            ? 'A PKCE code_challenge is required.'
            : q.code_challenge_method !== 'S256'
              ? 'code_challenge_method must be S256.'
              : q.resource !== undefined &&
                  (URL.parse(q.resource)?.pathname.replace(/\/$/, '') ?? '') !== MCP_PATH
                ? `resource must be this server's MCP address, ${mcpUrlOf(req)}.`
                : null;
      if (fault) throw new ProblemError('validation_failed', `The assistant's request: ${fault}`);
      const asked = (q.scope ?? '').split(' ').filter(Boolean);
      const scope: McpScope = asked.includes('write') ? 'write' : 'read';
      return { client, scope };
    };
    /** Back to the assistant, with the result and its `state` (RFC 6749 section 4.1.2). */
    const back = (
      req: FastifyRequest,
      redirectUri: string,
      params: Record<string, string>,
      state?: string,
    ) => {
      const u = new URL(redirectUri);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      if (state !== undefined) u.searchParams.set('state', state);
      u.searchParams.set('iss', originOf(req)); // RFC 9207
      return u.href;
    };

    app.get('/oauth/authorize', async (req) => {
      authn.authenticate(req, 'S');
      const { client, scope } = check(req, req.query as Query);
      return { client_name: client.name, redirect_uri: (req.query as Query).redirect_uri, scope };
    });

    app.post('/oauth/authorize', async (req) => {
      const { userId } = authn.authenticate(req, 'S');
      const b = (req.body ?? {}) as Query & { decision?: string; access?: string };
      const { client } = check(req, b);
      const redirectUri = b.redirect_uri!;
      const params =
        b.decision === 'allow'
          ? (() => {
              const at = now();
              const live = db
                .prepare(`SELECT count(*) FROM mcp_tokens WHERE user_id = @userId AND ${LIVE_SQL}`)
                .pluck()
                .get({ userId, at }) as number;
              if (live >= MAX_LIVE_TOKENS) {
                throw new ProblemError(
                  'validation_failed',
                  `You have ${MAX_LIVE_TOKENS} assistants connected. Disconnect one in Settings > AI assistants first.`,
                );
              }
              const code = randomBytes(32).toString('base64url');
              codes.set(hashToken(code), {
                clientId: client.id,
                userId,
                redirectUri,
                challenge: b.code_challenge!,
                scope: b.access === 'write' ? 'write' : 'read',
                expiresAt: at + CODE_MS,
              });
              for (const [k, p] of codes) if (p.expiresAt <= at) codes.delete(k);
              return { code };
            })()
          : { error: 'access_denied', error_description: 'The driver said no.' };
      return { redirect_to: back(req, redirectUri, params, b.state) };
    });

    // The token endpoint takes the standard form body; its own scope keeps that parser off the
    // rest of the API, where a form post is a cross-site request the browser sends unasked.
    void app.register(async (scope) => {
      scope.addContentTypeParser(
        'application/x-www-form-urlencoded',
        { parseAs: 'string' },
        (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))),
      );
      scope.post('/oauth/token', async (req, reply) => {
        const wait = failures.retryAfter(req.ip);
        if (wait > 0) {
          reply.header('Retry-After', String(wait));
          return oauthError(reply, 429, 'invalid_request', 'Too many failed attempts.');
        }
        const b = (req.body ?? {}) as Query;
        const refused = (error: string, description: string) => {
          failures.fail(req.ip);
          return oauthError(reply, 400, error, description);
        };
        const at = now();
        const issue = (rowId: number) => {
          const access = newAssistantToken();
          const refresh = newRefresh();
          db.prepare(
            'UPDATE mcp_tokens SET token_hash = ?, expires_at = ?, refresh_hash = ?, refresh_expires_at = ? WHERE id = ?',
          ).run(hashToken(access), at + ACCESS_MS, hashToken(refresh), at + REFRESH_MS, rowId);
          const row = db.prepare('SELECT scope FROM mcp_tokens WHERE id = ?').get(rowId) as {
            scope: McpScope;
          };
          return reply.header('Pragma', 'no-cache').send({
            access_token: access,
            token_type: 'Bearer',
            expires_in: ACCESS_MS / 1000,
            refresh_token: refresh,
            scope: row.scope === 'write' ? 'read write' : 'read',
          });
        };

        if (b.grant_type === 'authorization_code') {
          const key = hashToken(b.code ?? '');
          const pending = codes.get(key);
          codes.delete(key); // one use, even when the rest is wrong
          if (!pending || pending.expiresAt <= at) {
            return refused('invalid_grant', 'The code is wrong, used or out of date.');
          }
          if (pending.clientId !== b.client_id || pending.redirectUri !== b.redirect_uri) {
            return refused('invalid_grant', 'The code was given to another client or address.');
          }
          if (!b.code_verifier || !sameText(s256(b.code_verifier), pending.challenge)) {
            return refused('invalid_grant', 'The code_verifier does not match.');
          }
          const client = clientOf(pending.clientId);
          if (!client) return refused('invalid_client', 'The client is no longer registered.');
          const row = tokens.create({
            userId: pending.userId,
            name: client.name,
            scope: pending.scope,
            // Replaced at once by `issue`; a placeholder that no presented code can match.
            tokenHash: hashToken(randomBytes(32).toString('base64url')),
            createdAt: at,
            expiresAt: at,
          });
          db.prepare('UPDATE mcp_tokens SET client_id = ? WHERE id = ?').run(client.id, row.id);
          return issue(row.id);
        }

        if (b.grant_type === 'refresh_token') {
          const row = db
            .prepare(
              'SELECT id, client_id AS clientId, revoked_at AS revokedAt, refresh_expires_at AS until FROM mcp_tokens WHERE refresh_hash = ?',
            )
            .get(hashToken(b.refresh_token ?? '')) as
            { id: number; clientId: string; revokedAt: number | null; until: number } | undefined;
          if (!row || row.revokedAt !== null || row.until <= at) {
            return refused(
              'invalid_grant',
              'The refresh code is wrong, used, revoked or out of date.',
            );
          }
          if (b.client_id !== undefined && b.client_id !== row.clientId) {
            return refused('invalid_grant', 'The refresh code was given to another client.');
          }
          return issue(row.id);
        }

        return oauthError(
          reply,
          400,
          'unsupported_grant_type',
          'grant_type must be authorization_code or refresh_token.',
        );
      });
    });
  };
}
