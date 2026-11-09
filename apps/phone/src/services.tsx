import { algorithmVersion } from '@milewage/track-engine';
import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import { Platform } from 'react-native';
import type { FetchFn } from './api/client';
import { nativeNet, type NetPort } from './connect/reach';
import { healthProbe, RoutePicker } from './connect/route';
import { installCrashHandler, PhoneDiagnostics } from './diagnostics/phoneDiagnostics';
import { batteryPort, type BatteryPort } from './diagnostics/shiftSummary';
import { createLazyAppDb } from './db/lazyDb';
import { openExpoAppDb, type AppSqlDb } from './db/appDb';
import { Pairing, type KeyValueStore } from './pairing/pairing';
import { AndroidPermissions, createReactNativePermissionApi } from './permissions/android';
import type { PermissionsPort } from './permissions/ladder';
import { createNotifications, type NotificationsPort } from './notifications/port';
import { UnsyncedReminders } from './notifications/unsynced';
import { createFreeBytes } from './storage/freeSpace';
import { createExpoSecureBackend, SecureKeyValueStore } from './storage/secureStore';
import { openExpoDb, SqliteKeyValueStore } from './storage/sqliteStore';
import { ShiftController } from './shift/controller';
import { PointFeed } from './shift/feed';
import { PhoneEdits } from './store/edits';
import { ShiftStore } from './store/shiftStore';
import { DeviceSession } from './pairing/deviceSession';
import { ConnectionMonitor } from './sync/connection';
import { Outbox } from './sync/outbox';
import { createSender, type Sender } from './sync/sender';
import { QrScanner as CameraQrScanner } from './pairing/QrScanner';
import { createLazyNativeTracker, nativeBattery, nativeLocationSwitch } from './tracker/native';
import type { Tracker } from './tracker/types';

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
  /** VPN state and the Tailscale app, for the connection messages (19 section 3.5). */
  net: NetPort;
  /** Pairing, settings and the device session (`pairing.device`), which holds every halt of sending. */
  pairing: Pairing;
  /** Records shifts: start, the live distance, "End shift" and the hand-off to the sender. */
  shift: ShiftController;
  /** Shifts, trips and results on the phone (`app.db`). */
  shifts: ShiftStore;
  /** Trip, odometer and notes edits made on the phone. */
  edits: PhoneEdits;
  /** Sending to the server: the one status the screens show, "Sync now", the send loop. */
  sender: Sender;
  /** Plain key-value storage (caches, flags). */
  plain: KeyValueStore;
  /** The phone's own OS notifications; do nothing without the notifications permission. */
  notifications: NotificationsPort;
  /** The unsynced reminder as an OS notification (15 section 4.4), kept in step with the banner. */
  reminders: UnsyncedReminders;
  diagnostics: PhoneDiagnostics;
  /** Loads the diagnostics ring, applies the cached level and records `app.start` (once). */
  startDiagnostics: () => Promise<void>;
  /** Closes a 10-minute window: `upload.window`, `diag.self`, then sends the ring. */
  diagnosticsWindow: () => Promise<void>;
  /** Start the send loop when the home screen opens. Default on; tests turn it off. */
  autoUpload?: boolean;
  scanner?: QrScanner;
  /** How often the running distance is re-read, ms. */
  refreshMs?: number;
}

export interface Parts {
  tracker: Tracker;
  permissions: PermissionsPort;
  net: NetPort;
  secure: KeyValueStore;
  plain: KeyValueStore;
  /** Opens `app.db` (migrated on first use). */
  openAppDb: () => Promise<AppSqlDb>;
  fetch: FetchFn;
  /** Plain http to any address (debug builds); otherwise only to home addresses (plan 28). */
  anyHttp?: boolean;
  now?: () => number;
  newId?: () => string;
  scanner?: QrScanner;
  refreshMs?: number;
  rand?: () => number;
  /** Free device storage in bytes; null when it cannot be read (`storage/freeSpace.ts`). */
  freeBytes?: () => Promise<number | null>;
  /** OS notifications. Absent: a port that is never granted, so the banner is the only channel. */
  notifications?: NotificationsPort;
  /** Battery at shift start and end, for `shift.summary`. Absent: the summary is not sent. */
  battery?: BatteryPort;
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
  const device = new DeviceSession(p.plain);
  const monitor = new ConnectionMonitor(appDb, device);
  // Home or away for every request (plan 28 section 4.3); a server that moved on the Wi-Fi is
  // found again by its instance id.
  const route = new RoutePicker({
    localNetwork: () => p.net.localNetwork(),
    probe: healthProbe(p.fetch),
    now: p.now,
    rediscover: async (id) =>
      (await p.net.discover()).find((s) => s.instanceId === id)?.url ?? null,
    onHomeMoved: (url) => pairing.updateHome(url),
  });
  const pairing: Pairing = new Pairing({
    monitor,
    device,
    route,
    anyHttp: p.anyHttp,
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
  // The queue between the ones who change shifts (the recorder, the edits) and the sender.
  const queue = new Outbox(appDb, p.now);
  const edits = new PhoneEdits({
    db: appDb,
    store: shifts,
    queue,
    gnssOffsetMs: () => p.tracker.gnssOffsetMs(),
    now: p.now,
    newId: p.newId,
  });
  const shift = new ShiftController({
    tracker: p.tracker,
    feed,
    store: p.plain,
    shifts,
    queue,
    session,
    now: p.now,
    newId: p.newId,
    battery: p.battery,
    onSummary: async (id, summary) => {
      await diagnostics.load();
      diagnostics.recordShiftSummary(id, summary);
      await diagnostics.persist();
    },
  });
  const sender = createSender({
    db: appDb,
    queue,
    store: shifts,
    tracker: p.tracker,
    feed,
    recorder: shift,
    session,
    device,
    monitor,
    handshake: async () => {
      const st = await pairing.load();
      if (st) await pairing.refreshSettings(st);
    },
    onSettings: (s) => pairing.storeSettings(s),
    freeBytes: p.freeBytes,
    now: p.now,
    rand: p.rand,
  });

  const notifications =
    p.notifications ?? createNotifications({ permissions: p.permissions, backend: null });
  const reminders = new UnsyncedReminders({ port: notifications, plain: p.plain, now: p.now });

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
    diagnostics.recordUploadWindow(sender.takeUploadStats(), pending.length, oldest);
    diagnostics.recordSelf();
    const s = await session();
    if (s) await diagnostics.flush(s.client);
    await diagnostics.persist();
  };

  return {
    tracker: p.tracker,
    permissions: p.permissions,
    net: p.net,
    pairing,
    shift,
    shifts,
    edits,
    sender,
    plain: p.plain,
    notifications,
    reminders,
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
 * The production edges. The native tracker and the file-system reading load on first use, so
 * tests never touch them. The pairing credential is in the Keystore-backed store;
 * the active shift, cached settings, permission flags and the diagnostics ring are in SQLite.
 */
export function productionParts(): Parts {
  const c = Platform.constants as unknown as Record<string, unknown>;
  const plain = new SqliteKeyValueStore(() => openExpoDb());
  const permissions = new AndroidPermissions({
    api: createReactNativePermissionApi(),
    store: plain,
    locationEnabled: nativeLocationSwitch,
  });
  return {
    tracker: createLazyNativeTracker(),
    permissions,
    // No notifications library yet (progress.md PR N1): never granted, the banner is the channel.
    notifications: createNotifications({ permissions, backend: null }),
    freeBytes: createFreeBytes(),
    battery: batteryPort(nativeBattery),
    net: nativeNet(),
    secure: new SecureKeyValueStore(createExpoSecureBackend()),
    plain,
    openAppDb: () => openExpoAppDb(),
    fetch: (url, init) => fetch(url, init),
    anyHttp: __DEV__,
    scanner: CameraQrScanner,
    deviceInfo: {
      make: clean(c.Brand, 'unknown', /[^A-Za-z0-9 ._+-]/g),
      model: clean(c.Model, 'unknown', /[^A-Za-z0-9 ._+-]/g),
      android: clean(c.Release, '0', /[^A-Za-z0-9._+-]/g),
      sdk: Number(c.Version) > 0 ? Number(c.Version) : 1,
    },
  };
}

/** Production wiring, built once. */
export function defaultServices(): Services {
  if (cached) return cached;
  const s = createServices(productionParts());
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
