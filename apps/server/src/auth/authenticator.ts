import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { SessionRepository } from '../db';
import { ProblemError } from '../errors';
import type { AuthFn, Principal } from '../routes/util';
import { authenticate } from './sessions';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
/** `mwd_` / `mwp_` plus 43 base64url characters (256 random bits), so secret scanners can find one. */
export const newToken = (prefix: 'mwd_' | 'mwp_') => prefix + randomBytes(32).toString('base64url');

export type DeviceBranch = (tokenHash: string) => Principal;

/**
 * `authenticate(request) -> Principal` (08 section 16.5): the one place a credential is read.
 * The devices module plugs in the bearer branch; without it a bearer token is just unauthenticated.
 */
export class Authenticator {
  private devices?: DeviceBranch;
  constructor(
    private sessions: SessionRepository,
    private now: () => number,
  ) {}

  useDeviceBranch(branch: DeviceBranch) {
    this.devices = branch;
  }

  authenticate: AuthFn = ((request: FastifyRequest, allow: 'S' | 'SD'): Principal => {
    const bearer = /^Bearer (\S+)$/.exec(request.headers.authorization ?? '')?.[1];
    if (bearer === undefined)
      return { kind: 'session', ...authenticate(this.sessions, request, this.now()) };
    if (!this.devices || !/^mwd_[A-Za-z0-9_-]{43}$/.test(bearer)) {
      throw new ProblemError('auth_required', 'Sign in to continue.');
    }
    const principal = this.devices(hashToken(bearer));
    if (allow === 'S') throw new ProblemError('scope_forbidden', 'A device cannot do this.');
    return principal;
  }) as AuthFn;
}
