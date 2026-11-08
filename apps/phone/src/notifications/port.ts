import type { PermissionsPort } from '../permissions/ladder';

/**
 * The phone's own operating-system notifications (18 section 11: no push service, the phone
 * schedules its reminders itself). An `id` names one reminder: scheduling it again replaces the
 * pending one at once, and a shown or fired one replaces the one on screen, so the driver never
 * sees two copies.
 *
 * Android 13 and later: without the notifications permission nothing is shown or scheduled and
 * every call quietly does nothing; the in-app banner stays the only channel. The permission is
 * asked only on the existing ladder step (`permissions/ladder.ts`, step `notifications`), never
 * from here.
 */
export interface NotificationsPort {
  /** Shows a notification now. */
  show(id: string, title: string, body: string): Promise<void>;
  /** Shows a notification at about `atMs` (inexact: Android may delay it; no exact alarm). */
  schedule(id: string, atMs: number, title: string, body: string): Promise<void>;
  /** Removes the pending and the shown notification with this id. */
  cancel(id: string): Promise<void>;
  /** Whether a notification would reach the driver now. Reads, never asks. */
  granted(): Promise<boolean>;
}

/**
 * The channel for the phone's reminders. Named like the tracker's `milewage_shift` channel
 * (`LocationTrackingService.kt`); default importance: a sound, no pop-over.
 */
export const REMINDER_CHANNEL = {
  id: 'milewage_reminders',
  name: 'Reminders',
  importance: 'default',
} as const;

export interface NotificationRequest {
  id: string;
  title: string;
  body: string;
  channelId: string;
}

/** The raw OS calls a notifications library provides. No permission prompt in here. */
export interface NotificationBackend {
  /** False when the driver turned the app's notifications (or the channel) off in settings. */
  enabled(): Promise<boolean>;
  present(n: NotificationRequest): Promise<void>;
  /** Inexact, at or after `atMs`. */
  schedule(n: NotificationRequest & { atMs: number }): Promise<void>;
  cancel(id: string): Promise<void>;
}

/**
 * The production `NotificationsPort`: every call goes through the permission ladder's own reading
 * of `notifications` and does nothing unless it is `granted`. With no backend (none installed
 * yet, see progress.md PR N1) `granted()` is false and the banner remains the only channel.
 * A failing backend never breaks the app: errors are swallowed.
 */
export function createNotifications(d: {
  permissions: PermissionsPort;
  backend: NotificationBackend | null;
}): NotificationsPort {
  const { backend } = d;
  const granted = async () => {
    if (!backend) return false;
    try {
      const snap = await d.permissions.snapshot();
      return snap.notifications === 'granted' && (await backend.enabled());
    } catch {
      return false;
    }
  };
  const quietly = async (f: () => Promise<void>) => {
    try {
      await f();
    } catch {
      /* a reminder that cannot be shown is not an error the driver can act on */
    }
  };
  const channelId = REMINDER_CHANNEL.id;
  return {
    granted,
    show: async (id, title, body) => {
      if (backend && (await granted()))
        await quietly(() => backend.present({ id, title, body, channelId }));
    },
    schedule: async (id, atMs, title, body) => {
      if (backend && (await granted()))
        await quietly(() => backend.schedule({ id, title, body, channelId, atMs }));
    },
    // Cancelling needs no permission and must work after the driver turned notifications off.
    cancel: async (id) => {
      if (backend) await quietly(() => backend.cancel(id));
    },
  };
}
