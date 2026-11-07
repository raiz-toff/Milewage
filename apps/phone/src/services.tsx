import { algorithmVersion } from '@milewage/track-engine';
import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import { Platform } from 'react-native';
import type { FetchFn } from './api/client';
import { installCrashHandler, PhoneDiagnostics } from './diagnostics/phoneDiagnostics';
import { createLazyAppDb } from './db/lazyDb';
import { openExpoAppDb, type AppSqlDb } from './db/appDb';
import { Pairing, type KeyValueStore } from './pairing/pairing';
import { AndroidPermissions, createReactNativePermissionApi } from './permissions/android';
import type { PermissionsPort } from './permissions/ladder';
import { createExpoSecureBackend, SecureKeyValueStore } from './storage/secureStore';
import { openExpoDb, SqliteKeyValueStore } from './storage/sqliteStore';
import { ShiftController } from './shift/controller';
import { PUMP_LIMIT, PointFeed } from './shift/feed';
import { PhoneEdits } from './store/edits';
import { ShiftStore, type ServerRecon, type ServerShift } from './store/shiftStore';
import { SyncDrain } from './sync/drain';
import { ConnectionMonitor } from './sync/connection';
import { ChangePuller } from './sync/pull';
import { buildStatus, storageState, type SyncStatus } from './sync/status';
import { Outbox, shiftOf } from './sync/outbox';
import { OutboxRunner } from './sync/runner';
import { createLazyNativeTracker } from './tracker/native';
import type { Tracker } from './tracker/types';
import { UploadWorker } from './upload/worker';

/** A camera view that reports each decoded QR text. Absent until the camera adapter is wired. */
export type QrScanner = ComponentType<{ onScanned: (text: string) => void; busy?: boolean }>;

export interface DeviceInfo {
  make: string;
  model: string;
  android: string;
  sdk: number;
}

/**
 * Everything native or networked, behind interfaces, so screens are tested with fakes
 * (README 1.3 rule 4).
 */
export interface Services {
  tracker: Tracker;
  permissions: PermissionsPort;
  pairing: Pairing;
  feed: PointFeed;
  shift: ShiftController;
  /** Shifts, trips and results on the phone (`app.db`). */
  shifts: ShiftStore;
  outbox: Outbox;
  /** Trip, odometer and notes edits made on the phone. */
  edits: PhoneEdits;
  runner: OutboxRunner;
  /** Backlog drain: shifts oldest first, with progress, cancel and the live shift first (15 section 6). */
  sync: SyncDrain;
  puller: ChangePuller;
  monitor: ConnectionMonitor;
  /** Plain key-value storage (caches, flags). */
  plain: KeyValueStore;
  /** The numbers behind the home banner. */
  status: () => Promise<SyncStatus>;
  uploader: UploadWorker;
  diagnostics: PhoneDiagnostics;
  /** Loads the diagnostics ring, applies the cached level and records `app.start` (once). */
  startDiagnostics: () => Promise<void>;
  /** Closes a 10-minute window: `upload.window`, `diag.self`, then sends the ring. */
  diagnosticsWindow: () => Promise<void>;
  /** Start the upload loop when the home screen opens. Default on; tests turn it off. */
  autoUpload?: boolean;
  scanner?: QrScanner;
  /** How often the running distance is re-read, ms. */
  refreshMs?: number;
}

export interface Parts {
  tracker: Tracker;
  permissions: PermissionsPort;
  secure: KeyValueStore;
  plain: KeyValueStore;
  /** Opens `app.db` (migrated on first use). */
  openAppDb: () => Promise<AppSqlDb>;
  fetch: FetchFn;
  now?: () => number;
  newId?: () => string;
  scanner?: QrScanner;
  refreshMs?: number;
  rand?: () => number;
  /** Free device storage in bytes; null when it cannot be read. NOT wired in production yet. */
  freeBytes?: () => Promise<number | null>;
  autoUpload?: boolean;
  appVersion?: string;
  deviceInfo?: DeviceInfo;
}

const UNKNOWN_DEVICE: DeviceInfo = { make: 'unknown', model: 'unknown', android: '0', sdk: 1 };

/** Builds the object graph from its native/network edges. */
export function createServices(p: Parts): Services {
  const appVersion = p.appVersion ?? '0.1.0';
  const diagnostics = new PhoneDiagnostics({
    store: p.plain,
    appVersion,
    now: p.now,
    telemetryPending: () => p.tracker.readPending(1).length > 0,
  });
  const appDb = createLazyAppDb(p.openAppDb);
  const monitor = new ConnectionMonitor(appDb);
  const pairing = new Pairing({
    monitor,
    secure: p.secure,
    plain: p.plain,
    fetch: p.fetch,
    now: p.now,
    appVersion,
    onSettings: (s) => diagnostics.applySettings(s),
  });
  const feed = new PointFeed(p.tracker);
  const session = () => pairing.session();
  const shifts = new ShiftStore(appDb, p.now);
  const outbox = new Outbox(appDb, p.now);
  const edits = new PhoneEdits({
    db: appDb,
    store: shifts,
    outbox,
    gnssOffsetMs: () => p.tracker.gnssOffsetMs(),
    now: p.now,
    newId: p.newId,
  });
  const runner = new OutboxRunner({
    outbox,
    session,
    rand: p.rand,
    // shift.end waits until every point of the shift is uploaded or quarantined (15 section 6.2).
    canSend: (item) =>
      item.kind !== 'shift.end' ||
      !feed.readPending(PUMP_LIMIT).some((pt) => pt.shiftClientId === shiftOf(item.entityKey)),
    onSent: async ({ item, outcome, response }) => {
      if (item.kind !== 'shift.end') return;
      const id = shiftOf(item.entityKey);
      const body = response?.data as (ServerShift & { recon?: ServerRecon }) | undefined;
      if (outcome === 'sent' && typeof body?.id === 'number') {
        await shifts.applyEnd(id, body, body.recon ?? null);
      } else {
        await shifts.setSyncState(id, 'on_server');
      }
    },
    onParked: (item) => shifts.setSyncState(shiftOf(item.entityKey), 'needs_attention'),
  });
  // The worker and the shift controller need each other: the worker asks whether a shift is
  // created and to flush the outbox; the controller waits for the worker before it sends `end`.
  const late: { uploader?: UploadWorker } = {};
  const shift = new ShiftController({
    tracker: p.tracker,
    feed,
    store: p.plain,
    shifts,
    outbox,
    runner,
    session,
    now: p.now,
    newId: p.newId,
    beforeEnd: (id) => late.uploader!.drainShift(id),
  });
  const uploader = new UploadWorker({
    tracker: p.tracker,
    feed,
    session,
    shiftReady: (id) => shift.isCreated(id),
    shiftParked: (id) => shift.isParked(id),
    evictBlocked: () => monitor.restored,
    flushOutbox: () => shift.sync(),
    now: p.now,
    rand: p.rand,
  });
  late.uploader = uploader;
  const puller = new ChangePuller({
    db: appDb,
    outbox,
    session,
    onSettings: (s) => pairing.storeSettings(s),
    now: p.now,
  });
  const sync = new SyncDrain({
    pull: (force) => puller.pull({ force }),
    handshake: async () => {
      const st = await pairing.load();
      if (st) await pairing.refreshSettings(st);
    },
    store: shifts,
    outbox,
    runner,
    uploader,
    feed,
    controller: shift,
    now: p.now,
  });

  const status = async () => {
    const state = uploader.lastState;
    const counts = await outbox.counts();
    return buildStatus({
      shifts: await shifts.list(),
      parkedItems: counts.parked,
      oldestQueuedAt: counts.oldestAt,
      wrongServer: monitor.wrongServer,
      restored: monitor.restored,
      halted: runner.haltedState ?? (state === 'repair' || state === 'auth_problem' ? state : null),
      offline: state === 'backoff' || state === 'waiting_create',
      storage: storageState((await p.freeBytes?.()) ?? null),
    });
  };

  let started = false;
  const startDiagnostics = async () => {
    if (started) return;
    started = true;
    await diagnostics.load();
    const state = await pairing.load();
    if (state?.settings) diagnostics.applySettings(state.settings);
    diagnostics.recordAppStart({
      nativeV: '0.1.0',
      engineV: String(algorithmVersion),
      apiV: '1',
      device: p.deviceInfo ?? UNKNOWN_DEVICE,
    });
    await diagnostics.persist();
  };
  const diagnosticsWindow = async () => {
    const pending = p.tracker.readPending(10_000);
    const now = (p.now ?? Date.now)();
    const oldest = pending[0] ? Math.max(0, Math.round((now - pending[0].recordedAt) / 1000)) : 0;
    diagnostics.recordUploadWindow(uploader.takeStats(), pending.length, oldest);
    diagnostics.recordSelf();
    const s = await session();
    if (s) await diagnostics.flush(s.client);
    await diagnostics.persist();
  };

  return {
    tracker: p.tracker,
    permissions: p.permissions,
    pairing,
    feed,
    shift,
    shifts,
    outbox,
    edits,
    runner,
    sync,
    puller,
    monitor,
    plain: p.plain,
    status,
    uploader,
    diagnostics,
    startDiagnostics,
    diagnosticsWindow,
    autoUpload: p.autoUpload,
    scanner: p.scanner,
    refreshMs: p.refreshMs,
  };
}

let cached: Services | null = null;

const clean = (v: unknown, fallback: string, re: RegExp) =>
  String(v ?? fallback)
    .replace(re, '')
    .slice(0, 40) || fallback;

/**
 * Production wiring. The native tracker loads on first use, so tests never touch it.
 * NOT YET WIRED: the camera scanner. The pairing credential is in the Keystore-backed store;
 * the active shift, cached settings, permission flags and the diagnostics ring are in SQLite.
 */
export function defaultServices(): Services {
  if (cached) return cached;
  const c = Platform.constants as unknown as Record<string, unknown>;
  const plain = new SqliteKeyValueStore(() => openExpoDb());
  const s = createServices({
    tracker: createLazyNativeTracker(),
    permissions: new AndroidPermissions({ api: createReactNativePermissionApi(), store: plain }),
    secure: new SecureKeyValueStore(createExpoSecureBackend()),
    plain,
    openAppDb: () => openExpoAppDb(),
    fetch: (url, init) => fetch(url, init),
    deviceInfo: {
      make: clean(c.Brand, 'unknown', /[^A-Za-z0-9 ._+-]/g),
      model: clean(c.Model, 'unknown', /[^A-Za-z0-9 ._+-]/g),
      android: clean(c.Release, '0', /[^A-Za-z0-9._+-]/g),
      sdk: Number(c.Version) > 0 ? Number(c.Version) : 1,
    },
  });
  installCrashHandler(
    s.diagnostics,
    (globalThis as { ErrorUtils?: Parameters<typeof installCrashHandler>[1] }).ErrorUtils,
  );
  cached = s;
  return s;
}

const Context = createContext<Services | null>(null);

export function ServicesProvider({ value, children }: { value?: Services; children: ReactNode }) {
  return <Context.Provider value={value ?? defaultServices()}>{children}</Context.Provider>;
}

export function useServices(): Services {
  const value = useContext(Context);
  if (!value) throw new Error('useServices outside ServicesProvider');
  return value;
}
