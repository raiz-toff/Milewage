import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { SessionRepository } from '../db';
import { ProblemError } from '../errors';

const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
/**
 * `Secure` only when the page is https (plan 28, H-P5): a browser drops a `Secure` cookie set by a
 * plain http page (localhost excepted), so signing in at the home address `http://192.168.x.x`
 * would silently fail. The page's scheme is the browser's `Origin` (sent with every sign-in POST),
 * or `X-Forwarded-Proto` when it comes from the trusted proxy (Fastify's `protocol`).
 */
export const secureRequest = (request: FastifyRequest) =>
  request.protocol === 'https' || /^https:/i.test(request.headers.origin ?? '');

const cookie = (value: string, maxAge: number, secure: boolean) =>
  `mw_session=${value}; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Strict; Path=/; Max-Age=${maxAge}`;

export function startSession(
  sessions: SessionRepository,
  userId: number,
  now: number,
  secure: boolean,
): string {
  const value = randomBytes(32).toString('base64url');
  const row = { idHash: hash(value), userId, createdAt: now, expiresAt: now + TTL_MS };
  sessions.create({ ...row, lastSeenAt: now });
  return cookie(value, TTL_MS / 1000, secure);
}

export const clearCookie = (secure: boolean) => cookie('', 0, secure);

export function authenticate(sessions: SessionRepository, request: FastifyRequest, now: number) {
  const origin = request.headers.origin;
  if (request.method !== 'GET' && (!origin || !origin.endsWith(`//${request.headers.host}`))) {
    throw new ProblemError('origin_mismatch', 'The Origin header is missing or does not match.');
  }
  const pair = (request.headers.cookie ?? '')
    .split(/;\s*/)
    .find((p) => p.startsWith('mw_session='));
  const row = pair && sessions.find(hash(pair.slice('mw_session='.length)));
  if (!row) throw new ProblemError('auth_required', 'Sign in to continue.');
  if (row.expiresAt <= now) {
    sessions.delete(row.idHash);
    throw new ProblemError('session_expired', 'Your session expired. Sign in again.');
  }
  sessions.touch(row.idHash, now, now + TTL_MS);
  return { userId: row.userId, idHash: row.idHash };
}
