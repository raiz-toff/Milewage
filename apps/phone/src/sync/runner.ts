import { ApiError, type ApiClient, type ApiResponse } from '../api/client';
import type { DeviceSession } from '../pairing/deviceSession';
import { Backoff } from '../upload/worker';
import { shiftOf, type Outbox, type OutboxItem } from './outbox';
import { requestFor, send } from './shiftRequests';

/** `halted`: the device session stops sending (revoked, wrong server, sign-in problem). */
export type RunState = 'idle' | 'busy' | 'not_paired' | 'offline' | 'halted';

export interface RunResult {
  state: RunState;
  sent: number;
  parked: number;
  /** When to run again after a retryable failure; null otherwise. */
  retryInMs: number | null;
}

export interface Sent {
  item: OutboxItem;
  /** `finalized`: the server refused with 409 `shift_finalized`; nothing more can be sent. */
  outcome: 'sent' | 'finalized';
  response: ApiResponse<unknown> | null;
  /** False when the server answered `X-MileWage-Applied: false` (it kept its newer row, 15 section 8.2). */
  applied: boolean;
}

export interface RunnerDeps {
  outbox: Outbox;
  session: () => Promise<{ client: ApiClient } | null>;
  /** The device session: nothing is sent while it is halted. Its `resume` resets the backoff. */
  device: Pick<DeviceSession, 'halted' | 'subscribe'>;
  /**
   * Called before an item is sent. False keeps it (and everything after it for the same shift)
   * pending. The `shift.end` barrier plugs in here (15 section 6.2 step 3).
   */
  canSend?: (item: OutboxItem) => boolean | Promise<boolean>;
  /** Called after the server answered and the row was deleted. */
  onSent?: (sent: Sent) => void | Promise<void>;
  /** Called when the server refused an item for good and it was parked. */
  onParked?: (item: OutboxItem, error: ApiError) => void | Promise<void>;
  rand?: () => number;
}

/**
 * Sends outbox items one at a time, oldest first (15 section 6.2 step 4, 08 section 4.1). A
 * network failure or a 5xx stops the run and keeps the item pending (backoff 2/4/8/16/32/60 s);
 * a 4xx parks that item and holds back only the later items of the same shift; while the device
 * session is halted (a 401/403, a wrong server) nothing is sent. Nothing is ever dropped.
 */
export class OutboxRunner {
  private busy = false;
  private readonly backoff: Backoff;

  constructor(private readonly d: RunnerDeps) {
    this.backoff = new Backoff(d.rand);
    d.device.subscribe(() => this.backoff.reset());
  }

  /** Runs until the queue is empty, blocked, halted or a retryable failure. `shift` limits it to one shift. */
  async run(opts: { shift?: string } = {}): Promise<RunResult> {
    if (this.busy) return { state: 'busy', sent: 0, parked: 0, retryInMs: null };
    this.busy = true;
    try {
      return await this.loop(opts.shift);
    } finally {
      this.busy = false;
    }
  }

  private async loop(only?: string): Promise<RunResult> {
    const { outbox } = this.d;
    const res: RunResult = { state: 'idle', sent: 0, parked: 0, retryInMs: null };
    if (await this.d.device.halted()) return { ...res, state: 'halted' };
    const session = await this.d.session();
    if (!session) return { ...res, state: 'not_paired' };

    const blocked = new Set((await outbox.parked()).map((p) => shiftOf(p.entityKey)));
    for (const item of await outbox.pending()) {
      const shift = shiftOf(item.entityKey);
      if ((only && shift !== only) || blocked.has(shift)) continue;
      if (this.d.canSend && !(await this.d.canSend(item))) {
        blocked.add(shift);
        continue;
      }
      const req = requestFor(item);
      outbox.begin(item.id);
      try {
        const response = await send(session.client, req);
        await outbox.done(item.id);
        this.backoff.reset();
        res.sent++;
        await this.d.onSent?.({
          item,
          outcome: 'sent',
          response,
          applied: response.headers?.get('X-MileWage-Applied') !== 'false',
        });
      } catch (e) {
        if (!(e instanceof ApiError)) {
          // A bug or a kill, not an answer: the row stays as it is and the caller sees the throw.
          outbox.release(item.id);
          throw e;
        }
        if (await this.d.device.halted()) {
          await outbox.failed(item.id, e.code);
          return { ...res, state: 'halted' };
        }
        if (e.retryable) {
          await outbox.failed(item.id, e.code);
          return { ...res, state: 'offline', retryInMs: this.backoff.next(e.retryAfterS) };
        }
        if (e.status === 409 && e.code === 'shift_finalized' && item.kind !== 'shift.create') {
          await outbox.done(item.id);
          await this.d.onSent?.({ item, outcome: 'finalized', response: null, applied: false });
          continue;
        }
        await outbox.park(item.id, e.code);
        blocked.add(shift);
        res.parked++;
        await this.d.onParked?.(item, e);
      }
    }
    return res;
  }
}
