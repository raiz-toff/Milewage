import {
  diagKinds,
  validateEvent,
  type DiagKind,
  type DiagnosticsPort,
  type EventSubscriptions,
} from '@milewage/shared';
import type { DiskState } from '../disk';
import type { DropReason } from './keeper';
import type { DiagnosticsStore } from './store';

/** The level in force: `verbose` reverts to `basic` once `diagnostics_verbose_until` has passed (16 section 5). */
export function effectiveLevel(
  row:
    | { diagnosticsLevel: 'off' | 'basic' | 'verbose'; diagnosticsVerboseUntil: number | null }
    | undefined,
  now: number,
): 'off' | 'basic' | 'verbose' {
  const setting = row?.diagnosticsLevel ?? 'basic';
  return setting === 'verbose' && (row?.diagnosticsVerboseUntil ?? 0) <= now ? 'basic' : setting;
}

export interface RecorderOptions {
  store: () => DiagnosticsStore;
  now: () => number;
  /** Owner of the server's own events; none before setup. */
  owner: () => number | undefined;
  /** The owner's level now (`verbose` already reverted to `basic` after its 7 days). */
  level: (userId: number) => 'off' | 'basic' | 'verbose';
  disk?: () => DiskState;
  version: string;
  /** The `client_id` of a shift by its database id, for the envelope's `shift`. */
  shiftClientId: (id: number) => string | undefined;
  drop: (reason: DropReason) => void;
}

/**
 * The server's own `DiagnosticsPort` (16 section 3.3): validates against the shared schema like every other
 * producer (a rejected event is only counted), honours the level, and pauses while writes are blocked.
 * Hosts never import it: the diagnostics module subscribes to facts on the event bus (08 section 16.4).
 */
export function createServerRecorder(o: RecorderOptions) {
  const record = (kind: DiagKind, data: Record<string, unknown>, shift?: string): void => {
    const userId = o.owner();
    if (userId === undefined) return;
    const spec = diagKinds[kind];
    const level = o.level(userId);
    if (level === 'off' || (spec.level === 'verbose' && level !== 'verbose')) {
      return o.drop('level_off');
    }
    if (o.disk?.() === 'writes_blocked') return o.drop('disk_low');
    const checked = validateEvent({
      kind,
      at: o.now(),
      level: spec.level,
      src: 'server',
      ...(shift ? { shift } : {}),
      v: o.version,
      data,
    });
    if (!checked.ok) return o.drop('schema_reject');
    o.store().insert({ userId, deviceId: null, receivedAt: o.now(), event: checked.event });
  };
  const port: DiagnosticsPort = { record };

  const subscriptions: EventSubscriptions = {
    'engine.ran': (p) =>
      record(
        'engine.run',
        {
          host: 'server',
          reason: p.reason,
          calc_version: p.calcVersion,
          segmenter: p.segmenter,
          input_digest: p.inputDigest,
          ms: p.ms,
          stats: p.stats,
          flags: p.flags,
          trips: p.trips,
          stops: p.stops,
          total_m: p.totalM,
          active_m: p.activeM,
          deadhead_m: p.deadheadM,
        },
        o.shiftClientId(Number(p.shiftId)),
      ),
    'shift.reconciled': (p) =>
      record(
        'recon.result',
        {
          status: p.status,
          reasons: p.reasons,
          diff_m: p.diffM,
          digest_equal: p.digestEqual,
          phone_calc_v: p.phoneCalcV,
          server_calc_v: p.serverCalcV,
        },
        o.shiftClientId(Number(p.shiftId)),
      ),
    'capture.state': (p) =>
      record('capture.state', { event: p.event, profile: p.profile, shifts_done: p.shiftsDone }),
    'backup.finished': (p) =>
      record('backup.run', {
        trigger: p.trigger,
        ok: p.ok,
        ms: p.ms,
        bytes: p.bytes,
        lag_max_ms: p.lagMaxMs,
      }),
  };
  return { port, record, subscriptions, version: o.version, ready: () => o.owner() !== undefined };
}
export type ServerRecorder = ReturnType<typeof createServerRecorder>;
