import type { ShiftRow } from '../store/shiftStore';

const DAY = 86_400_000;
export const REMIND_FIRST_DAYS = 3;
export const REMIND_STRONG_DAYS = 7;
export const LOW_STORAGE_BYTES = 200 * 1024 * 1024;
export const CRITICAL_STORAGE_BYTES = 50 * 1024 * 1024;

/** The marker on a shift row (15 section 4.1). */
export function markerFor(s: Pick<ShiftRow, 'sync_state' | 'recon_status'>): {
  icon: 'hollow' | 'spinner' | 'check' | 'check_diff' | 'warning';
  label: string;
} {
  switch (s.sync_state) {
    case 'local':
      return { icon: 'hollow', label: 'On phone only' };
    case 'syncing':
      return { icon: 'spinner', label: 'Sending' };
    case 'needs_attention':
      return { icon: 'warning', label: 'Needs attention' };
    default:
      return s.recon_status === 'differs'
        ? { icon: 'check_diff', label: 'On server (total differs)' }
        : { icon: 'check', label: 'On server' };
  }
}

/** Plain-store key: when the banner last showed the unsynced reminder (epoch ms). */
export const REMINDER_SHOWN_KEY = 'reminder.lastShownAt';

export interface Reminder {
  level: 'none' | 'normal' | 'strong';
  text: string;
  /** Epoch ms of the next reminder after this one is shown. */
  nextAt: number;
}

/**
 * Unsynced reminders (15 section 4.4): at 3 days, then every day, with stronger words from 7 days.
 * `lastShownAt` is when the previous one was shown (null: none yet). Constants, not settings.
 */
export function reminderFor(
  oldestUnsyncedAt: number | null,
  unsyncedShifts: number,
  now: number,
  lastShownAt: number | null,
): Reminder {
  const none: Reminder = { level: 'none', text: '', nextAt: Infinity };
  if (oldestUnsyncedAt === null || unsyncedShifts === 0) return none;
  const age = now - oldestUnsyncedAt;
  const first = oldestUnsyncedAt + REMIND_FIRST_DAYS * DAY;
  if (age < REMIND_FIRST_DAYS * DAY) return { ...none, nextAt: first };
  if (lastShownAt !== null && now - lastShownAt < DAY)
    return { ...none, nextAt: lastShownAt + DAY };
  const n = `${unsyncedShifts} ${unsyncedShifts === 1 ? 'shift is' : 'shifts are'}`;
  if (age >= REMIND_STRONG_DAYS * DAY) {
    return {
      level: 'strong',
      text: `${n} only on this phone, for ${Math.floor(age / DAY)} days. If the phone is lost they are gone. Open MileWage when you reach your server.`,
      nextAt: now + DAY,
    };
  }
  return {
    level: 'normal',
    text: `${n} only on this phone. Open MileWage when you reach your server.`,
    nextAt: now + DAY,
  };
}

export type StorageState = 'unknown' | 'normal' | 'low' | 'critical';

/** 15 section 3.4; `null` free space (no reading) is "unknown", never "normal". */
export function storageState(freeBytes: number | null): StorageState {
  if (freeBytes === null) return 'unknown';
  if (freeBytes < CRITICAL_STORAGE_BYTES) return 'critical';
  return freeBytes < LOW_STORAGE_BYTES ? 'low' : 'normal';
}

export const STORAGE_TEXT: Record<StorageState, string> = {
  unknown: '',
  normal: '',
  low: 'Phone storage is low. Free some space so MileWage can keep recording.',
  critical: 'Phone storage is almost full. MileWage may stop recording. Free some space now.',
};

export interface StatusInput {
  shifts: Pick<ShiftRow, 'sync_state' | 'started_at' | 'ended_at' | 'point_count' | 'status'>[];
  parkedItems: number;
  oldestQueuedAt: number | null;
  wrongServer: boolean;
  /** The server was restored from a backup and shifts are still being sent again. */
  restored: boolean;
  /** `repair` (revoked) or `auth_problem` from the last upload or outbox run. */
  halted: 'repair' | 'auth_problem' | null;
  offline: boolean;
  storage: StorageState;
}

export interface SyncStatus {
  color: 'green' | 'yellow' | 'red';
  unsyncedShifts: number;
  unsyncedPoints: number;
  oldestAt: number | null;
  /** The sentence to show for a red state or a notice, in the order of 15 section 9.4. */
  message: string | null;
}

/** The home banner (15 section 4.3): green nothing pending, yellow pending or offline, red needs attention. */
export function buildStatus(i: StatusInput): SyncStatus {
  const open = i.shifts.filter((s) => s.sync_state !== 'on_server');
  const times = open.map((s) => s.ended_at ?? s.started_at);
  if (i.oldestQueuedAt !== null) times.push(i.oldestQueuedAt);
  const oldestAt = times.length > 0 ? Math.min(...times) : null;
  const attention = open.some((s) => s.sync_state === 'needs_attention') || i.parkedItems > 0;
  let message: string | null = null;
  if (i.wrongServer) {
    message =
      'This address now points to a different MileWage server than the one this phone was paired with. Nothing was sent.';
  } else if (i.halted === 'repair') {
    message = 'This phone was removed from your server. Re-pair to send your saved data.';
  } else if (i.halted === 'auth_problem') {
    message = 'Sign-in problem. Re-pair this phone.';
  } else if (i.restored) {
    // 15 section 9.3, word for word: older points were deleted from the phone and cannot be sent.
    message =
      'The server was restored from a backup. MileWage is re-sending the last 14 days from your phone.';
  } else if (i.storage === 'critical' || i.storage === 'low') {
    message = STORAGE_TEXT[i.storage];
  } else if (attention) {
    message = 'Some items could not be sent. Open the shift to see why.';
  } else if (i.offline && open.length > 0) {
    message = 'Offline. Saved on your phone.';
  }
  const red =
    i.wrongServer || i.halted !== null || attention || i.restored || i.storage === 'critical';
  return {
    color: red ? 'red' : open.length > 0 || i.offline || i.storage === 'low' ? 'yellow' : 'green',
    unsyncedShifts: open.length,
    unsyncedPoints: open.reduce((a, s) => a + (s.point_count ?? 0), 0),
    oldestAt,
    message,
  };
}
