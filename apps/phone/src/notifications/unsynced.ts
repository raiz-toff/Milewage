import type { KeyValueStore } from '../pairing/pairing';
import { REMINDER_SHOWN_KEY, reminderFor, type SyncStatus } from '../sync/status';
import type { NotificationsPort } from './port';

/** The one id of the unsynced reminder: a new one replaces the old, never a second copy. */
export const UNSYNCED_ID = 'unsynced';
export const UNSYNCED_TITLE = 'Shifts only on this phone';
/** Plain-store key: the reminder pending in the OS (`at`, `text`) and the last one shown now. */
export const UNSYNCED_KEY = 'notify.unsynced';

interface Saved {
  at: number;
  text: string;
  shownAt: number | null;
}

const parse = (raw: string | null): Saved | null => {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Saved>;
    return typeof v.at === 'number' && typeof v.text === 'string'
      ? { at: v.at, text: v.text, shownAt: typeof v.shownAt === 'number' ? v.shownAt : null }
      : null;
  } catch {
    return null;
  }
};

const latest = (...xs: (number | null)[]) => {
  const ok = xs.filter((x): x is number => x !== null && Number.isFinite(x) && x > 0);
  return ok.length > 0 ? Math.max(...ok) : null;
};

/**
 * The unsynced-data reminder as an operating-system notification (15 section 4.4): after 3 days,
 * then at most once a day, stronger words from 7 days; the same rule and words as the banner
 * (`reminderFor`). Each run keeps exactly one reminder pending in the OS, for the next time one
 * is due, so the driver is reminded even when the app stays closed. A reminder counts as given
 * when the banner showed it, when the pending one's time has passed, or when this shows one now.
 * Nothing pending: the pending and the shown one are cancelled. No permission: nothing is done.
 */
export class UnsyncedReminders {
  constructor(
    private readonly d: {
      port: NotificationsPort;
      plain: KeyValueStore;
      now?: () => number;
    },
  ) {}

  async update(s: Pick<SyncStatus, 'oldestAt' | 'unsyncedShifts'>): Promise<void> {
    const { port, plain } = this.d;
    const saved = parse(await plain.get(UNSYNCED_KEY));
    if (s.oldestAt === null || s.unsyncedShifts === 0) {
      if (saved) {
        await port.cancel(UNSYNCED_ID);
        await plain.remove(UNSYNCED_KEY);
      }
      return;
    }
    if (!(await port.granted())) return;
    const now = (this.d.now ?? Date.now)();
    const fired = saved && saved.at <= now ? saved.at : null;
    const banner = Number(await plain.get(REMINDER_SHOWN_KEY));
    let last = latest(banner, fired, saved?.shownAt ?? null);
    let shownAt = saved?.shownAt ?? null;
    const due = reminderFor(s.oldestAt, s.unsyncedShifts, now, last);
    if (due.level !== 'none') {
      await port.show(UNSYNCED_ID, UNSYNCED_TITLE, due.text);
      last = shownAt = now;
    }
    const at = due.nextAt;
    // Its words as they will read then (the day count, and "stronger" once 7 days have passed).
    const text = reminderFor(s.oldestAt, s.unsyncedShifts, at, last).text;
    if (saved && saved.at === at && saved.text === text && saved.shownAt === shownAt) return;
    if (!saved || saved.at !== at || saved.text !== text) {
      await port.schedule(UNSYNCED_ID, at, UNSYNCED_TITLE, text);
    }
    await plain.set(UNSYNCED_KEY, JSON.stringify({ at, text, shownAt } satisfies Saved));
  }
}
