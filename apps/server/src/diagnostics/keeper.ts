import type { ModuleJob } from '@milewage/shared';
import type { DiskState } from '../disk';
import type { DiagnosticsStore } from './store';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
/** Events table cap (16 section 7.2). */
export const EVENT_CAP_BYTES = 100 * 1024 * 1024;

export type DropReason = 'ring_full' | 'schema_reject' | 'level_off' | 'disk_low';

export interface KeeperOptions {
  store: () => DiagnosticsStore;
  now: () => number;
  disk?: () => DiskState;
  /** Owner of the server's own events; none before setup. */
  owner: () => number | undefined;
  version: string;
  capBytes?: number;
  /** Interval of the housekeeping job; a day unless a test shortens it. */
  everyMs?: number;
  log?: (message: string, fields?: object) => void;
}

/**
 * Housekeeping of diagnostics.db (16 section 7.2): the nightly prune of expired rows, the size cap, and the
 * server's own `diag.self` report of what it dropped. It is paused while the disk is `writes_blocked`;
 * the counts are kept and reported when it recovers.
 */
export function createDiagnosticsKeeper(o: KeeperOptions) {
  const dropped: Record<DropReason, number> = {
    ring_full: 0,
    schema_reject: 0,
    level_off: 0,
    disk_low: 0,
  };
  let since = o.now();
  let cpu = process.cpuUsage();
  let writes = 0;

  function selfReport(receivedAt: number): boolean {
    const userId = o.owner();
    if (userId === undefined) return false;
    const store = o.store();
    const hours = Math.max((receivedAt - since) / HOUR, 1 / 60);
    const used = process.cpuUsage(cpu);
    const written = store.written() - writes;
    const stored = store.insert({
      userId,
      deviceId: null,
      receivedAt,
      event: {
        src: 'server',
        at: receivedAt,
        level: 'basic',
        kind: 'diag.self',
        v: o.version,
        data: {
          dropped: { ...dropped },
          pending: 0,
          ring_kb: 0,
          // Whole-process CPU, not diagnostics alone: an upper bound on its cost.
          cpu_ms_per_h: Math.round((used.user + used.system) / 1000 / hours),
          writes_per_h: Math.round(written / hours),
        },
      },
    });
    for (const k of Object.keys(dropped) as DropReason[]) dropped[k] = 0;
    since = receivedAt;
    cpu = process.cpuUsage();
    writes = store.written();
    return stored;
  }

  const keeper = {
    /** Counts events the server refused or discarded; reported in the next `diag.self`. */
    drop(reason: DropReason, n = 1) {
      dropped[reason] += n;
    },
    counts: () => ({ ...dropped }),
    /** One housekeeping pass. Returns what it did; does nothing at all while writes are blocked. */
    run() {
      if (o.disk?.() === 'writes_blocked') return { paused: true as const };
      const t = o.now();
      const store = o.store();
      store.rollUp(t); // before the raw events expire
      const expired = store.pruneExpired(t);
      const capped = store.enforceCap(o.capBytes ?? EVENT_CAP_BYTES);
      const reported = selfReport(t);
      return { paused: false as const, expired, capped, reported };
    },
    job(): ModuleJob {
      return {
        name: 'diagnostics-housekeeping',
        start: () => {
          const timer = setInterval(() => {
            try {
              const r = keeper.run();
              if (!r.paused) o.log?.('diagnostics housekeeping', r);
            } catch (e) {
              o.log?.('diagnostics housekeeping failed', { error: (e as Error).message });
            }
          }, o.everyMs ?? DAY);
          timer.unref();
          return () => clearInterval(timer);
        },
      };
    },
  };
  return keeper;
}
export type DiagnosticsKeeper = ReturnType<typeof createDiagnosticsKeeper>;
