import { useSyncExternalStore } from 'react';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';

/**
 * The service worker's update flow (plan 27 section 4.3). A new version installs in the
 * background and waits; `needRefresh` turns true and the page offers Reload. Reload tells the
 * waiting worker to take over, and the page reloads once it has (vite-plugin-pwa), so one page
 * never runs two versions. Later only hides the offer for this visit.
 */
type Register = (options: RegisterSWOptions) => (reloadPage?: boolean) => Promise<void>;

/** How often an open page asks the server for a new version. */
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

let needRefresh = false;
let apply: (() => Promise<void>) | null = null;
const listeners = new Set<() => void>();

function set(value: boolean) {
  needRefresh = value;
  for (const l of listeners) l();
}

/**
 * Registers the service worker where the browser allows one (https or localhost); on plain http
 * there is no `navigator.serviceWorker` and nothing happens. `register` is `registerSW` from
 * `virtual:pwa-register`, passed in so tests can stand in for it.
 */
export function startUpdates(register: Register): void {
  if (!('serviceWorker' in navigator)) return;
  const update = register({
    immediate: true,
    onNeedRefresh: () => set(true),
    onRegisteredSW: (_url, registration) => {
      if (!registration) return;
      setInterval(() => {
        // Offline, the check would only fail; an installing worker is already on its way.
        if (navigator.onLine && !registration.installing) void registration.update();
      }, UPDATE_CHECK_MS);
    },
    onRegisterError: (error) => console.warn('Service worker not registered', error),
  });
  apply = () => update(true);
}

export function useUpdate(): { ready: boolean; reload: () => void; later: () => void } {
  const ready = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => needRefresh,
  );
  return { ready, reload: () => void apply?.(), later: () => set(false) };
}

/** Test only: back to a page that registered nothing. */
export function resetUpdates(): void {
  apply = null;
  set(false);
}
