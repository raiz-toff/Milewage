/**
 * What the server is doing right now (`mode` in `GET /system/status`, 08). While `restoring`, every
 * API route answers 503 `restoring` and the phone keeps buffering (10 section 7 step 2).
 */
export type ServerMode = 'normal' | 'read_only' | 'restoring';

export interface ServerState {
  readonly mode: ServerMode;
  /** Why the server is not in normal mode, for the status page. */
  readonly reason: string | undefined;
  set(mode: ServerMode, reason?: string): void;
}

export function createServerState(): ServerState {
  let mode: ServerMode = 'normal';
  let reason: string | undefined;
  return {
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
