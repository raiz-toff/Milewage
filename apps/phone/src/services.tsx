import { algorithmVersion } from '@milewage/track-engine';
import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import { Platform } from 'react-native';
import type { FetchFn } from './api/client';
import { installCrashHandler, PhoneDiagnostics } from './diagnostics/phoneDiagnostics';
import { MemoryStore, Pairing, type KeyValueStore } from './pairing/pairing';
import { notWiredPermissions } from './permissions/fake';
import type { PermissionsPort } from './permissions/ladder';
import { ShiftController } from './shift/controller';
import { PointFeed } from './shift/feed';
import { createLazyNativeTracker } from './tracker/native';
import type { Tracker } from './tracker/types';
import { UploadWorker } from './upload/worker';

/** A camera view that reports each decoded QR text. Absent until the camera adapter is wired. */
export type QrScanner = ComponentType<{ onScanned: (text: string) => void }>;

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
  fetch: FetchFn;
  now?: () => number;
  newId?: () => string;
  scanner?: QrScanner;
  refreshMs?: number;
  rand?: () => number;
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
  const pairing = new Pairing({
    secure: p.secure,
    plain: p.plain,
    fetch: p.fetch,
    now: p.now,
    appVersion,
    onSettings: (s) => diagnostics.applySettings(s),
  });
  const feed = new PointFeed(p.tracker);
  const session = () => pairing.session();
  // The worker and the shift controller need each other: the worker asks whether a shift is
  // created and to flush the outbox; the controller waits for the worker before it sends `end`.
  const late: { uploader?: UploadWorker } = {};
  const shift = new ShiftController({
    tracker: p.tracker,
    feed,
    store: p.plain,
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
    flushOutbox: () => shift.sync(),
    now: p.now,
    rand: p.rand,
  });
  late.uploader = uploader;

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
 * NOT YET WIRED: the Keystore-backed secure store (the credential, the active shift and the
 * diagnostics ring live in memory only), the camera scanner and the OS permission adapter.
 */
export function defaultServices(): Services {
  if (cached) return cached;
  const c = Platform.constants as unknown as Record<string, unknown>;
  const s = createServices({
    tracker: createLazyNativeTracker(),
    permissions: notWiredPermissions,
    secure: new MemoryStore(),
    plain: new MemoryStore(),
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
