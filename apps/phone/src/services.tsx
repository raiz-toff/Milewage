import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import { MemoryStore, Pairing } from './pairing/pairing';
import { notWiredPermissions } from './permissions/fake';
import type { PermissionsPort } from './permissions/ladder';
import { createLazyNativeTracker } from './tracker/native';
import type { Tracker } from './tracker/types';

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
  scanner?: QrScanner;
}

let cached: Services | null = null;

/**
 * Production wiring. The native tracker loads on first use, so tests never touch it.
 * NOT YET WIRED: the Keystore-backed secure store (the credential lives in memory only), the
 * camera scanner and the OS permission adapter.
 */
export function defaultServices(): Services {
  cached ??= {
    tracker: createLazyNativeTracker(),
    permissions: notWiredPermissions,
    pairing: new Pairing({
      secure: new MemoryStore(),
      plain: new MemoryStore(),
      fetch: (url, init) => fetch(url, init),
    }),
  };
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
