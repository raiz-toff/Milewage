import type { ApiError } from '../api/client';
import type { KeyValueStore } from './pairing';

/**
 * Why this phone may not send to its server right now (08 section 4.3, 15 section 9.4):
 * - `repair`: the server revoked this phone (401 `device_revoked`). Kept across restarts; the app
 *   start gate asks to connect again.
 * - `wrong_server`: the address answers as another MileWage server than the one paired with.
 * - `auth_problem`: any other 401 or 403.
 */
export type HaltReason = 'repair' | 'wrong_server' | 'auth_problem';

/** The stored revoke (the key predates this module). */
const K_REVOKED = 'pairing.revoked';

/** The halt a refusal from the server means, if any. The one place 401 and 403 are read. */
export function haltFor(e: ApiError): HaltReason | null {
  if (e.status !== 401 && e.status !== 403) return null;
  return e.code === 'device_revoked' ? 'repair' : 'auth_problem';
}

/**
 * The device session's halt: the one holder of "stop sending" for every sender on the phone (the
 * outbox runner, the upload worker, the change puller, the restore resend). The device client
 * records a halt from the server's answers; pairing again (a code, a link) and the driver's "Sync
 * now" or "Check the address" call `resume`, which lifts every halt at once.
 */
export class DeviceSession {
  private revoked = false;
  private wrongServer = false;
  private authProblem = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly plain: KeyValueStore) {}

  /** Why sending is stopped, most serious first; null when it is not. */
  async halted(): Promise<HaltReason | null> {
    if (this.revoked || (await this.plain.get(K_REVOKED)) !== null) return 'repair';
    if (this.wrongServer) return 'wrong_server';
    return this.authProblem ? 'auth_problem' : null;
  }

  /** True while no request may leave at all (another server answers at this address). */
  blocked = (): boolean => this.wrongServer;

  /** Stops every sender. Takes effect at once; a revoke is also stored. Listeners hear each one. */
  async halt(reason: HaltReason): Promise<void> {
    if (reason === 'repair') this.revoked = true;
    else if (reason === 'wrong_server') this.wrongServer = true;
    else this.authProblem = true;
    try {
      if (reason === 'repair' && (await this.plain.get(K_REVOKED)) === null) {
        await this.plain.set(K_REVOKED, '1');
      }
    } finally {
      this.changed();
    }
  }

  /** Lifts every halt: senders go again on their next run. A server that still refuses halts again. */
  async resume(): Promise<void> {
    this.revoked = false;
    this.wrongServer = false;
    this.authProblem = false;
    try {
      await this.plain.remove(K_REVOKED);
    } finally {
      this.changed();
    }
  }

  /** Called after every halt and resume. Returns the unsubscribe. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private changed() {
    for (const fn of [...this.listeners]) fn();
  }
}
