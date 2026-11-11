import {
  createArchiveRepository,
  createOdometerRepository,
  createProcessingRepository,
  createShiftRepository,
  type Db,
  type ShiftFilter,
  type ShiftRow,
} from '../db';
import type { DriverContexts } from '../driver-context';
import { ProblemError } from '../errors';
import type { EventEmit } from '../events';
import type { Principal } from '../routes/util';
import { createShiftProcessor, type PhoneReport } from './shift-processor';

const DAY = 24 * 60 * 60 * 1000;
/** A device token reads 14 days (08 section 2.2; the DECISIONS.md row of 2026-11-03). */
export const DEVICE_READ_WINDOW_MS = 14 * DAY;

/** What a phone sends when the driver ends a shift (08 section 4.4). */
export interface PhoneEnd {
  endedAt: number;
  manifest?: PhoneReport['manifest'];
  result?: PhoneReport['result'];
  interruptions?: { from_ms: number; to_ms: number }[];
}

/** What changed a shift that is already recorded; it decides how the shift is computed and announced. */
export type ShiftChange =
  /** A trip was added, edited or deleted (`tripId` names it for the change log). */
  | { cause: 'trip'; tripId?: number; tripKey?: string; deleted?: boolean }
  /** The phone's edit of an automatic trip by its key (14 section 6.4). */
  | { cause: 'override' }
  /** A stop label was set or cleared; only the engine can apply it. */
  | { cause: 'label' }
  /** The driver asked for a recalculation. */
  | { cause: 'recalc' };

/**
 * The shift book: the one place that records a shift, recomputes it and announces it, and the one
 * read window. Routes and the late-point job call it and only parse and present.
 *
 * Rules kept here:
 * - A device reads shifts started, or written to by a device, in the last 14 days; a web session
 *   reads everything. A device write marks the shift as touched.
 * - A finalized shift is never changed or recomputed (`shift_finalized`).
 * - A running shift is computed when it ends. After that the track engine runs while the `tracking`
 *   module is on and the raw points are kept; otherwise the totals are re-added from the stored
 *   trips. A recalculation or a stop label needs the engine: on archived points `not_recomputable`.
 * - Every change is announced: `shift.started`, `shift.ended`, `shift.updated` (with `trip.updated`
 *   first for a trip), `shift.finalized`, `shift.deleted`, and `stops.derived` after every engine
 *   run while the `stops` module is on. The change log the phone pulls is built from these.
 */
export interface ShiftBook {
  /** The start of a principal's read window, or undefined for a web session. */
  since(p: Principal): number | undefined;
  /** A shift by id or client UUID inside the read window (`shift_not_found`); `editable` also refuses a finalized one. */
  find(p: Principal, ref: string, o?: { editable?: boolean }): ShiftRow;
  /** Shifts inside the read window, newest first (up to `limit + 1`). */
  list(p: Principal, f: ShiftFilter): ShiftRow[];
  /** A new running shift; its local date and segmenter come from the driver's settings now. */
  start(
    p: Principal,
    s: {
      clientId: string;
      vehicleId: number;
      startedAt: number;
      segmenter?: ShiftRow['segmenter'];
      notes?: string;
    },
  ): ShiftRow;
  /** Records the phone's end of a running shift and computes it, comparing the phone's result. */
  end(p: Principal, row: ShiftRow, e: PhoneEnd): ShiftRow;
  /** The driver's own fields (notes, vehicle) and the edit time. */
  edit(
    p: Principal,
    row: ShiftRow,
    set: Pick<Partial<ShiftRow>, 'notes' | 'vehicleId' | 'updatedAt'>,
  ): ShiftRow;
  /** The driver reviewed it; from now on nothing changes it. */
  finalize(row: ShiftRow): ShiftRow;
  /** Deletes the shift and everything under it; the phone is told which keys went. */
  purge(p: Principal, row: ShiftRow): void;
  /** A device wrote to the shift (points, an odometer reading): it stays in that device's window. */
  touch(p: Principal, row: ShiftRow): void;
  /** Refuses a change only the engine can apply when the raw points are gone (`not_recomputable`). */
  needsEngine(row: ShiftRow): void;
  /** After a trip, an override or a stop label was written, or on Recalculate: compute and announce. */
  recompute(p: Principal, row: ShiftRow, change: ShiftChange): ShiftRow;
  /** Points arrived after the end (08 section 5 step 6): an ended shift is computed again. */
  latePoints(shiftId: number): ShiftRow | undefined;
}

export function createShiftBook({
  db,
  now,
  drivers,
  emit,
  trackingModule,
  stopsModule,
}: {
  db: Db;
  now: () => number;
  drivers: DriverContexts;
  /** `bus.emit`; sync, diagnostics and the backup on shift end listen. */
  emit: EventEmit;
  /** Whether the `tracking` module is on: without it there are no points to run the engine on. */
  trackingModule: () => boolean;
  /** Whether the `stops` module is on: an engine run then stores stops and reads labels. */
  stopsModule: () => boolean;
}): ShiftBook {
  const shifts = createShiftRepository(db);
  const processing = createProcessingRepository(db);
  const odometer = createOdometerRepository(db);
  const archive = createArchiveRepository(db);
  const processor = createShiftProcessor({ db, now, stopsModule, emit });

  const since = (p: Principal) => (p.kind === 'device' ? now() - DEVICE_READ_WINDOW_MS : undefined);
  const touched = (p: Principal): Partial<ShiftRow> =>
    p.kind === 'device' ? { deviceTouchedAt: now() } : {};
  const id = (row: ShiftRow) => ({ shiftId: String(row.id) });
  /** Facts after an engine run. */
  const ran = (row: ShiftRow) => {
    if (stopsModule()) emit('stops.derived', id(row));
  };

  return {
    since,
    find(p, ref, o = {}) {
      const row = shifts.byRef(p.userId, ref, since(p));
      if (!row) throw new ProblemError('shift_not_found', 'No such shift.');
      if (o.editable && row.status === 'finalized')
        throw new ProblemError('shift_finalized', 'This shift is finalized.');
      return row;
    },
    list: (p, f) => shifts.list(p.userId, f, since(p)),

    start(p, s) {
      const driver = drivers.of(p.userId);
      const row = shifts.insert({
        userId: p.userId,
        clientId: s.clientId,
        vehicleId: s.vehicleId,
        status: 'active',
        startedAt: s.startedAt,
        localDate: driver.dateOf(s.startedAt),
        // Captured now and kept: a later change of the setting never re-cuts this shift.
        segmenter: s.segmenter ?? (driver.stopsOn ? 'stops' : 'whole_shift'),
        notes: s.notes ?? null,
        updatedAt: s.startedAt, // the edit clock starts at capture time, so offline edits made later still win
        ...touched(p),
      });
      emit('shift.started', id(row));
      return row;
    },

    end(p, row, e) {
      const ended = {
        status: 'ended' as const,
        endedAt: e.endedAt,
        updatedAt: e.endedAt,
        ...touched(p),
        phoneTotalM: e.result?.totalM ?? null,
        phoneCalcVersion: e.result?.calcVersion ?? null,
        inputDigest: e.result?.inputDigest ?? null,
        interruptionsJson: e.interruptions ? JSON.stringify(e.interruptions) : null,
        reconStatus: e.result ? ('pending' as const) : ('phone_missing' as const),
      };
      if (!trackingModule()) {
        const saved = shifts.update(row.id, ended) ?? row;
        emit('shift.ended', id(row));
        return saved;
      }
      const outcome = processor.run(
        { ...row, ...ended },
        { manifest: e.manifest, result: e.result, reason: 'shift_end' },
        ended,
      );
      emit('shift.ended', id(row));
      ran(row);
      return outcome.shift;
    },

    edit(p, row, set) {
      const saved = shifts.update(row.id, { ...set, ...touched(p) }) ?? row;
      emit('shift.updated', id(row));
      return saved;
    },

    finalize(row) {
      const saved = shifts.update(row.id, { status: 'finalized', updatedAt: now() }) ?? row;
      emit('shift.finalized', id(row));
      return saved;
    },

    purge(p, row) {
      const tripKeys = processing.tripsOf(row.id).map((t) => t.tripKey);
      const overrideKeys = processing.overridesOf(row.id).map((o) => o.tripKey);
      const odometerIds = odometer.idsOfShift(row.id).map(String);
      shifts.purge(row.id);
      emit('shift.deleted', {
        ...id(row),
        userId: String(p.userId),
        clientId: row.clientId,
        tripKeys,
        overrideKeys,
        odometerIds,
      });
    },

    touch(p, row) {
      if (p.kind === 'device') shifts.update(row.id, touched(p));
    },

    needsEngine: processor.assertRecomputable,

    recompute(p, row, change) {
      let saved = row;
      let engine = false;
      if (row.status !== 'active') {
        // Recalculate and labels ask for the engine; a trip change is re-added when it cannot run.
        const asked = change.cause === 'recalc' || change.cause === 'label';
        engine = trackingModule() && (asked || !archive.hasArchive(row.id));
        saved = engine
          ? processor.run(row, { reason: change.cause === 'label' ? 'label' : 'recalc' }).shift
          : processor.retotal(row);
      }
      if (p.kind === 'device') saved = shifts.update(saved.id, touched(p)) ?? saved;
      if (change.cause === 'trip' && change.tripId !== undefined) {
        emit('trip.updated', {
          ...id(row),
          tripId: String(change.tripId),
          ...(change.deleted ? { tripKey: change.tripKey, deleted: true } : {}),
        });
      }
      emit('shift.updated', id(row));
      if (engine) ran(row);
      return saved;
    },

    latePoints(shiftId) {
      const row = shifts.byId(shiftId);
      // A running shift is computed at its end; a finalized one is the driver's tax record.
      if (!row || row.status !== 'ended') return undefined;
      const saved = processor.run(row, { latePoints: true, reason: 'late_points' }).shift;
      emit('shift.updated', id(row));
      ran(row);
      return saved;
    },
  };
}
