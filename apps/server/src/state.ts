/**
 * What the server is doing right now (`mode` in `GET /system/status`, 08). While `restoring`, every
 * API route answers 503 `restoring` and the phone keeps buffering (10 section 7 step 2).
 */
export type ServerMode = 'normal' | 'read_only' | 'restoring';

/** What the last start did about the schema (10 section 10), for the status page. */
export interface MigrationReport {
  status: 'none' | 'running' | 'applied' | 'failed' | 'blocked';
  /** Migration ids that were pending at start. */
  pending: string[];
  /** The verified pre-migration backup, relative to the backups volume. */
  backup: string | null;
  /** Why it failed or was blocked; never includes data. */
  error?: string;
}

export interface ServerState {
  readonly mode: ServerMode;
  /** Why the server is not in normal mode, for the status page. */
  readonly reason: string | undefined;
  set(mode: ServerMode, reason?: string): void;
  migration: MigrationReport;
}

export function createServerState(): ServerState {
  let mode: ServerMode = 'normal';
  let reason: string | undefined;
  return {
    migration: { status: 'none', pending: [], backup: null },
    get mode() {
      return mode;
    },
    get reason() {
      return reason;
    },
    set(next, why) {
      mode = next;
      reason = why;
    },
  };
}
