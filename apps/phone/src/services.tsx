import { createContext, useContext, type ReactNode } from 'react';
import { notWiredPermissions } from './permissions/fake';
import type { PermissionsPort } from './permissions/ladder';
import { createLazyNativeTracker } from './tracker/native';
import type { Tracker } from './tracker/types';

/**
 * Everything native or networked, behind interfaces, so screens are tested with fakes
 * (README 1.3 rule 4). Later PRs add members (credential store, scanner, upload worker).
 */
export interface Services {
  tracker: Tracker;
  permissions: PermissionsPort;
}

let cached: Services | null = null;

/** Production wiring. The native tracker loads on first use, so tests never touch it. */
export function defaultServices(): Services {
  cached ??= { tracker: createLazyNativeTracker(), permissions: notWiredPermissions };
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
