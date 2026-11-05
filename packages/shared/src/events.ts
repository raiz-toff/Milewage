// Typed in-process event bus (08 section 16.4): fire-and-forget, no broker. Payloads are minimal ids for now.
export interface EventMap {
  'shift.started': { shiftId: string };
  'shift.ended': { shiftId: string };
  'shift.updated': { shiftId: string; flags?: string[] };
  'shift.finalized': { shiftId: string };
  /** A shift and everything under it was purged (web only); the keys let the pull path write tombstones. */
  'shift.deleted': {
    shiftId: string;
    userId: string;
    clientId: string;
    tripKeys: string[];
    overrideKeys: string[];
    odometerIds: string[];
  };
  'stops.derived': { shiftId: string };
  'stop_label.updated': { shiftId: string; stopId: string };
  'trip.updated': { shiftId: string; tripId: string; tripKey?: string; deleted?: boolean };
  'telemetry.accepted': { shiftId: string; deviceId: string; count: number };
  /** Every telemetry batch for a known shift, duplicates and rejects included (the ingest counters of `api.window`). */
  'telemetry.batch': {
    shiftId: string;
    deviceId: string;
    received: number;
    inserted: number;
    duplicates: number;
    rejected: Record<string, number>;
  };
  /** The shared engine ran on the server's stored points (16 section 3.2 `engine.run`). */
  'engine.ran': {
    shiftId: string;
    reason: 'shift_end' | 'late_points' | 'label' | 'recalc';
    ms: number;
    calcVersion: number;
    segmenter: 'stops' | 'whole_shift';
    inputDigest: string;
    stats: Record<string, number>;
    flags: string[];
    trips: number;
    stops: number;
    totalM: number;
    activeM: number;
    deadheadM: number;
  };
  /** The server's result was compared with the phone's (16 section 3.2 `recon.result`). */
  'shift.reconciled': {
    shiftId: string;
    status: 'match' | 'differs' | 'phone_missing';
    reasons: string[];
    diffM: number;
    digestEqual: boolean;
    phoneCalcV: number;
    serverCalcV: number;
  };
  /** A capture session changed state (16 section 3.2 `capture.state`). */
  'capture.state': {
    event: 'created' | 'started' | 'ended' | 'expired' | 'purged';
    profile: 'dense';
    shiftsDone: number;
  };
  /** A backup run ended, verified or not (16 section 3.2 `backup.run`). */
  'backup.finished': {
    trigger: 'nightly' | 'shift_end' | 'manual' | 'pre_migration' | 'pre_restore';
    ok: boolean;
    ms: number;
    bytes: number;
    lagMaxMs: number;
  };
  /** A typed earnings row was written or removed (18 section 4.3). */
  'earnings.changed': { shiftId: string };
  /** An expense or a recurring template was created, changed or deleted (18 section 5). */
  'expense.changed': { expenseId: string };
  /** A goal was created, changed or deleted (18 section 8.1). */
  'goals.changed': { userId: string };
  'device.seen': { deviceId: string };
  'odometer.updated': { odometerId: string; userId: string; deleted?: boolean };
  'vehicle.updated': { vehicleId: string };
  'settings.updated': { userId: string };
  /** A newer edit replaced a value (08 section 4.4); `superseded` is the old value in its API shape. */
  'edit.overwritten': {
    userId: string;
    entity: string;
    key: string;
    superseded: unknown;
    deviceId?: string;
  };
}

export type EventName = keyof EventMap;
export type EventHandler<E extends EventName> = (payload: EventMap[E]) => void;
export type EventSubscriptions = { [E in EventName]?: EventHandler<E> };

export interface EventBus {
  on<E extends EventName>(name: E, handler: EventHandler<E>): () => void;
  emit<E extends EventName>(name: E, payload: EventMap[E]): void;
}

export function createEventBus(
  onHandlerError: (name: EventName, error: unknown) => void = () => {},
): EventBus {
  const handlers = new Map<EventName, Set<(payload: never) => void>>();
  return {
    on(name, handler) {
      const set = handlers.get(name) ?? new Set();
      set.add(handler as (payload: never) => void);
      handlers.set(name, set);
      return () => void set.delete(handler as (payload: never) => void);
    },
    emit(name, payload) {
      for (const h of [...(handlers.get(name) ?? [])]) {
        try {
          (h as (p: typeof payload) => void)(payload);
        } catch (error) {
          onHandlerError(name, error);
        }
      }
    },
  };
}
