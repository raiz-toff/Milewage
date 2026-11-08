import { useSyncExternalStore } from 'react';

/**
 * Installing MileWage as an app (plan 27 section 4.4). Chromium browsers (Chrome, Edge, Samsung
 * Internet) fire `beforeinstallprompt` once MileWage can be installed; the page keeps it and opens
 * the browser's dialog from a click. Safari and Firefox have no such event, so the page shows
 * their steps instead.
 *
 * - `installed`: running as the installed app, or just installed.
 * - `prompt`: the browser's install dialog can be opened.
 * - `ios`, `safari-mac`, `firefox-android`: the browser installs from its own menu.
 * - `insecure`: plain http, where browsers install nothing.
 * - `unsupported`: anything else (Firefox on desktop, or Chrome before it has offered).
 */
export type InstallState =
  'installed' | 'prompt' | 'ios' | 'safari-mac' | 'firefox-android' | 'insecure' | 'unsupported';

/** Chromium's event (not in TypeScript's DOM types). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'mw-install-dismissed';
const DISPLAY_MODES = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'];

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

/** The browser's install path from its user agent, for browsers without `beforeinstallprompt`. */
export function browserKind(
  ua: string,
  maxTouchPoints = 0,
): 'ios' | 'safari-mac' | 'firefox-android' | 'other' {
  // iPadOS asks for the desktop site by default, so it reads as a Mac with a touch screen.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua) && /Firefox\//.test(ua)) return 'firefox-android';
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua))
    return 'safari-mac';
  return 'other';
}

/** Whether this page runs as the installed app (its own window, not a browser tab). */
export function isStandalone(): boolean {
  return (
    DISPLAY_MODES.some((m) => window.matchMedia?.(`(display-mode: ${m})`).matches) ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export function installState(): InstallState {
  if (installed || isStandalone()) return 'installed';
  const kind = browserKind(navigator.userAgent, navigator.maxTouchPoints);
  // Safari adds any site to the Home Screen or the Dock, https or not.
  if (kind === 'ios' || kind === 'safari-mac') return kind;
  if (!window.isSecureContext) return 'insecure';
  if (deferred) return 'prompt';
  return kind === 'firefox-android' ? kind : 'unsupported';
}

/**
 * Called once at start-up, before React: the event can fire before the app has rendered.
 * `preventDefault()` stops Android's own mini-infobar; the app offers the install itself.
 */
let capturing = false;
export function captureInstallPrompt(): void {
  if (capturing) return;
  capturing = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
  });
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', emit);
}

/** Opens the browser's install dialog; the event works once, so it is dropped afterwards. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred;
  if (!event) return 'unavailable';
  deferred = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === 'accepted') installed = true;
  emit();
  return outcome;
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) !== null;
  } catch {
    return false;
  }
}

/** "Not now" on the sidebar card: it does not come back by itself (Settings keeps the button). */
export function dismissInstallCard(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, new Date().toISOString());
  } catch {
    // Storage blocked: hidden for this visit only.
  }
  dismissedThisVisit = true;
  emit();
}
let dismissedThisVisit = false;

/** The card shows only where one click or one short step installs, and never once dismissed. */
export const cardShows = (state: InstallState, dismissed: boolean) =>
  !dismissed && (state === 'prompt' || state === 'ios' || state === 'safari-mac');

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useInstall(): { state: InstallState; dismissed: boolean } {
  const state = useSyncExternalStore(subscribe, installState);
  const dismissed = useSyncExternalStore(subscribe, () => dismissedThisVisit || readDismissed());
  return { state, dismissed };
}

/** Test only: a page that has seen no install event. */
export function resetInstall(): void {
  deferred = null;
  installed = false;
  dismissedThisVisit = false;
  emit();
}
