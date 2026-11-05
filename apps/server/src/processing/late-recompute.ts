import type { EventSubscriptions, ModuleJob } from '@milewage/shared';
import { createShiftRepository, type Db } from '../db';
import type { EventEmit } from '../events';
import type { ShiftProcessor } from './shift-processor';

export interface LateRecomputeOptions {
  db: Db;
  processor: ShiftProcessor;
  /** Set once the routes are registered (the bus belongs to the host). */
  emit: () => EventEmit | undefined;
  stopsOn: () => boolean;
  /** Debounce of 08 section 5 step 6: 5 seconds unless a test shortens it. */
  delayMs?: number;
  /** A burst never postpones the run beyond this long after the first point (default 30 s). */
  maxWaitMs?: number;
  log?: (message: string, fields?: object) => void;
}

/**
 * Points that arrive after a shift ended recompute it, debounced per shift (08 section 5 step 6,
 * 14 section 11). An `active` shift is computed at its end, and a `finalized` shift is never
 * recomputed automatically (it is the driver's tax record): the telemetry route already refuses
 * its points, and this check is the second guard.
 */
export function createLateRecompute({
  db,
  processor,
  emit,
  stopsOn,
  delayMs = 5000,
  maxWaitMs = 30_000,
  log,
}: LateRecomputeOptions) {
  const shifts = createShiftRepository(db);
  const timers = new Map<number, { timer: NodeJS.Timeout; since: number }>();

  const fire = (shiftId: number) => {
    timers.delete(shiftId);
    try {
      const shift = shifts.byId(shiftId);
      if (!shift || shift.status !== 'ended') return;
      processor.run(shift, { latePoints: true, reason: 'late_points' });
      emit()?.('shift.updated', { shiftId: String(shiftId) });
      if (stopsOn()) emit()?.('stops.derived', { shiftId: String(shiftId) });
    } catch (e) {
      log?.('late-point recompute failed', { shiftId, error: (e as Error).message });
    }
  };
  const schedule = (shiftId: number) => {
    const old = timers.get(shiftId);
    const since = old?.since ?? Date.now();
    if (old) clearTimeout(old.timer);
    const wait = Math.max(0, Math.min(delayMs, since + maxWaitMs - Date.now()));
    const timer = setTimeout(() => fire(shiftId), wait);
    timer.unref();
    timers.set(shiftId, { timer, since });
  };

  const subscriptions: EventSubscriptions = {
    'telemetry.accepted'(p) {
      const id = Number(p.shiftId);
      if (shifts.byId(id)?.status === 'ended') schedule(id);
    },
  };
  const job: ModuleJob = {
    name: 'late-point-recompute',
    start: () => () => {
      for (const t of timers.values()) clearTimeout(t.timer);
      timers.clear();
    },
  };
  return { subscriptions, job, schedule, pending: () => timers.size };
}
