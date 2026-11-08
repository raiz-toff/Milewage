import type { NotificationBackend, NotificationRequest, NotificationsPort } from './port';

interface Note {
  title: string;
  body: string;
}

/** Test double for screens and services: what is on screen and what is pending, by id. */
export class FakeNotifications implements NotificationsPort {
  /** Set false to act as Android 13+ with the permission refused. */
  allowed = true;
  showing = new Map<string, Note>();
  pending = new Map<string, Note & { atMs: number }>();
  /** Every call, in order, for tests that count them. */
  calls: string[] = [];

  async granted() {
    return this.allowed;
  }

  async show(id: string, title: string, body: string) {
    this.calls.push(`show ${id}`);
    if (this.allowed) this.showing.set(id, { title, body });
  }

  async schedule(id: string, atMs: number, title: string, body: string) {
    this.calls.push(`schedule ${id}`);
    if (this.allowed) this.pending.set(id, { title, body, atMs });
  }

  async cancel(id: string) {
    this.calls.push(`cancel ${id}`);
    this.showing.delete(id);
    this.pending.delete(id);
  }
}

/** Test double for the raw OS calls behind `createNotifications`. */
export class FakeNotificationBackend implements NotificationBackend {
  on = true;
  presented: NotificationRequest[] = [];
  scheduled: (NotificationRequest & { atMs: number })[] = [];
  cancelled: string[] = [];
  /** When set, every present/schedule/cancel throws it. */
  fail: Error | null = null;

  async enabled() {
    return this.on;
  }

  async present(n: NotificationRequest) {
    if (this.fail) throw this.fail;
    this.presented.push(n);
  }

  async schedule(n: NotificationRequest & { atMs: number }) {
    if (this.fail) throw this.fail;
    this.scheduled.push(n);
  }

  async cancel(id: string) {
    if (this.fail) throw this.fail;
    this.cancelled.push(id);
  }
}
