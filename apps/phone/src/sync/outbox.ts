import type { AppSqlDb } from '../db/appDb';

/**
 * The kinds the engine sends. `diag.batch` and `capture.batch` exist in the table (15 section 2.2)
 * but are sent by the diagnostics code at the lowest priority, never by this engine.
 */
export type OutboxKind =
  'shift.create' | 'shift.patch' | 'odometer.put' | 'trip.override' | 'trip.manual' | 'shift.end';

export const OUTBOX_KINDS: readonly OutboxKind[] = [
  'shift.create',
  'shift.patch',
  'odometer.put',
  'trip.override',
  'trip.manual',
  'shift.end',
];

/** Latest write wins in place: the request is a full-state upsert (15 section 6.2 step 4). */
const COALESCED: ReadonlySet<OutboxKind> = new Set([
  'odometer.put',
  'trip.override',
  'trip.manual',
]);

export interface OutboxItem {
  id: number;
  kind: OutboxKind;
  entityKey: string;
  /** The exact API v1 request body (frozen, 08 section 8). */
  body: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  lastError: string | null;
  status: 'pending' | 'parked';
}

interface Row {
  id: number;
  kind: OutboxKind;
  entity_key: string;
  body: string;
  created_at: number;
  attempts: number;
  last_error: string | null;
  status: 'pending' | 'parked';
}

const toItem = (r: Row): OutboxItem => ({
  id: r.id,
  kind: r.kind,
  entityKey: r.entity_key,
  body: JSON.parse(r.body) as Record<string, unknown>,
  createdAt: r.created_at,
  attempts: r.attempts,
  lastError: r.last_error,
  status: r.status,
});

/** The shift an item is about: every entity key starts with the shift's client id (a UUID). */
export const shiftOf = (entityKey: string): string => entityKey.split(':')[0]!;

/**
 * The durable FIFO of changes the server has not acknowledged yet (08 section 4.1, 15 section 6.2).
 * Rows are kept until the server answers; a `done` row is deleted at once. Everything in it is
 * idempotent on the server (client ids, upserts), so resending after a kill is always safe.
 */
export class Outbox {
  private inFlight = new Set<number>();

  constructor(
    private readonly db: AppSqlDb,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Adds an item. A pending `odometer.put`, `trip.override` or `trip.manual` for the same entity
   * that is not being sent right now is replaced in place instead (it keeps its place in the
   * queue and its creation time). `shift.create` and `shift.end` are never coalesced.
   */
  async enqueue(
    kind: OutboxKind,
    entityKey: string,
    body: Record<string, unknown>,
  ): Promise<number> {
    const json = JSON.stringify(body);
    if (COALESCED.has(kind)) {
      const existing = await this.db.getAllAsync<{ id: number }>(
        "SELECT id FROM outbox WHERE status = 'pending' AND kind = ? AND entity_key = ? ORDER BY id DESC",
        kind,
        entityKey,
      );
      const target = existing.find((r) => !this.inFlight.has(r.id));
      if (target) {
        await this.db.runAsync(
          'UPDATE outbox SET body = ?, attempts = 0, last_error = NULL WHERE id = ?',
          json,
          target.id,
        );
        return target.id;
      }
    }
    const r = await this.db.runAsync(
      'INSERT INTO outbox (kind, entity_key, body, created_at) VALUES (?, ?, ?, ?)',
      kind,
      entityKey,
      json,
      this.now(),
    );
    return r.lastInsertRowId;
  }

  /** Pending items in send order, oldest first. */
  async pending(): Promise<OutboxItem[]> {
    return this.list("status = 'pending'");
  }

  async parked(): Promise<OutboxItem[]> {
    return this.list("status = 'parked'");
  }

  private async list(where: string): Promise<OutboxItem[]> {
    const rows = await this.db.getAllAsync<Row>(
      `SELECT * FROM outbox WHERE ${where} AND kind IN (${OUTBOX_KINDS.map(() => '?').join(',')}) ORDER BY id`,
      ...OUTBOX_KINDS,
    );
    return rows.map(toItem);
  }

  async counts(): Promise<{ pending: number; parked: number; oldestAt: number | null }> {
    const r = await this.db.getFirstAsync<{ p: number; k: number; o: number | null }>(
      `SELECT SUM(status = 'pending') AS p, SUM(status = 'parked') AS k,
              MIN(CASE WHEN status <> 'done' THEN created_at END) AS o
         FROM outbox WHERE kind IN (${OUTBOX_KINDS.map(() => '?').join(',')})`,
      ...OUTBOX_KINDS,
    );
    return { pending: r?.p ?? 0, parked: r?.k ?? 0, oldestAt: r?.o ?? null };
  }

  /** True when this shift still has an unsent item of `kind` (pending or parked). */
  async has(kind: OutboxKind, shiftClientId: string): Promise<boolean> {
    const r = await this.db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM outbox WHERE kind = ? AND status <> 'done' AND (entity_key = ? OR entity_key LIKE ?)",
      kind,
      shiftClientId,
      `${shiftClientId}:%`,
    );
    return (r?.n ?? 0) > 0;
  }

  begin(id: number): void {
    this.inFlight.add(id);
  }

  /** Forget that an item is being sent without changing it (the attempt was interrupted). */
  release(id: number): void {
    this.inFlight.delete(id);
  }

  /** The server answered: the row is deleted. */
  async done(id: number): Promise<void> {
    await this.db.runAsync('DELETE FROM outbox WHERE id = ?', id);
    this.inFlight.delete(id);
  }

  /** The attempt failed in a way that may pass (network, 5xx): keep the row pending. */
  async failed(id: number, error: string): Promise<void> {
    await this.db.runAsync(
      'UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?',
      error,
      id,
    );
    this.inFlight.delete(id);
  }

  /** The server refused it for good (4xx): kept for the driver to see, never sent again unless retried. */
  async park(id: number, error: string): Promise<void> {
    await this.db.runAsync(
      "UPDATE outbox SET status = 'parked', attempts = attempts + 1, last_error = ? WHERE id = ?",
      error,
      id,
    );
    this.inFlight.delete(id);
  }

  /** Puts parked items back in the queue (after the driver fixed the cause), optionally one shift's. */
  async retryParked(shiftClientId?: string): Promise<number> {
    const r = shiftClientId
      ? await this.db.runAsync(
          "UPDATE outbox SET status = 'pending', last_error = NULL WHERE status = 'parked' AND (entity_key = ? OR entity_key LIKE ?)",
          shiftClientId,
          `${shiftClientId}:%`,
        )
      : await this.db.runAsync(
          "UPDATE outbox SET status = 'pending', last_error = NULL WHERE status = 'parked'",
        );
    return r.changes;
  }

  /** Removes everything queued for a shift (the driver discarded a never-uploaded shift). */
  async dropShift(shiftClientId: string): Promise<void> {
    await this.db.runAsync(
      'DELETE FROM outbox WHERE entity_key = ? OR entity_key LIKE ?',
      shiftClientId,
      `${shiftClientId}:%`,
    );
  }
}
