import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import { MemoryStore, Pairing, type KeyValueStore } from './pairing/pairing';
import { notWiredPermissions } from './permissions/fake';
import type { PermissionsPort } from './permissions/ladder';
import { PointFeed } from './shift/feed';
import { ShiftController } from './shift/controller';
import { UploadWorker } from './upload/worker';
import { createLazyNativeTracker } from './tracker/native';
import type { Tracker } from './tracker/types';
import type { FetchFn } from './api/client';

/** A camera view that reports each decoded QR text. Absent until the camera adapter is wired. */
export type QrScanner = ComponentType<{ onScanned: (text: string) => void }>;

/**
 * Everything native or networked, behind interfaces, so screens are tested with fakes
 * (README 1.3 rule 4). Later PRs add members (upload worker, diagnostics).
 */
export interface Services {
  tracker: Tracker;
  permissions: PermissionsPort;
  pairing: Pairing;
  feed: PointFeed;
  shift: ShiftController;
  uploader: UploadWorker;
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
}

/** Builds the object graph from its native/network edges. */
export function createServices(p: Parts): Services {
  const pairing = new Pairing({ secure: p.secure, plain: p.plain, fetch: p.fetch, now: p.now });
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
  return {
    tracker: p.tracker,
    permissions: p.permissions,
    pairing,
    feed,
    shift,
    uploader,
    autoUpload: p.autoUpload,
    scanner: p.scanner,
    refreshMs: p.refreshMs,
  };
}

let cached: Services | null = null;

/**
 * Production wiring. The native tracker loads on first use, so tests never touch it.
 * NOT YET WIRED: the Keystore-backed secure store (the credential and the active shift live in
 * memory only), the camera scanner and the OS permission adapter.
 */
export function defaultServices(): Services {
  cached ??= createServices({
    tracker: createLazyNativeTracker(),
    permissions: notWiredPermissions,
    secure: new MemoryStore(),
    plain: new MemoryStore(),
    fetch: (url, init) => fetch(url, init),
  });
  return cached;
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
