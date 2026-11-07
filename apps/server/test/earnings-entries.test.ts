import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createEarningsRepository,
  loadMigrations,
  MIGRATIONS_DIR,
  migrate,
  openDatabase,
  totalOf,
} from '../src/index';
import { harness, type Harness } from './support';

// 22 sections 3 and 4: earnings as entries with signed amounts; today's rows moved without loss.

const opts = { labels: false, entries: true, override: 'replace' as const };

describe('migration earnings/0002 on a database with rows', () => {
  test('every amount, count, note and source reads back; zeros stay a row; cascade still works', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mw-entries-'));
    const db = openDatabase(join(dir, 'milewage.db'));
    try {
      const all = loadMigrations(MIGRATIONS_DIR);
      migrate(
        db,
        all.filter((m) => !(m.module === 'earnings' && m.id === '0002_earning_entries')),
      );
      db.exec(`INSERT INTO users VALUES (1, 'sam', 'x', 1);
        INSERT INTO settings (user_id, country, distance_unit, currency, timezone, updated_at) VALUES (1, 'CA', 'km', 'CAD', 'UTC', 1);
        INSERT INTO vehicles (id, user_id, name, kind, created_at) VALUES (7, 1, 'Civic', 'car', 1);
        INSERT INTO shifts (id, user_id, client_id, vehicle_id, status, started_at, local_date, segmenter, updated_at) VALUES
          (1, 1, 'a', 7, 'ended', 1, '2026-01-01', 'stops', 1),
          (2, 1, 'b', 7, 'finalized', 1, '2026-01-02', 'whole_shift', 1);
        INSERT INTO shift_earnings (user_id, shift_id, platform, gross_cents, tips_cents, bonus_cents, orders, online_min, notes, source, edited_at) VALUES
          (1, 1, 'doordash', 3000, 500, 250, 7, 180, 'busy night', 'manual', 11),
          (1, 1, 'ubereats', 800, 0, 0, NULL, NULL, NULL, 'manual', 12),
          (1, 1, 'other', 0, 0, 0, 2, NULL, NULL, 'manual', 13),
          (1, 2, 'skipthedishes', 4500, 120, 0, NULL, NULL, NULL, 'import', 14);`);

      expect(migrate(db, all)).toEqual(['earnings/0002_earning_entries']);

      const repo = createEarningsRepository(db);
      // platform, gross, tips, bonus, orders, online minutes, notes, source, edited at, balance
      const pick = (shiftId: number) =>
        repo
          .ofShift(shiftId)
          .map((r) =>
            [r.platform, r.grossCents, r.tipsCents, r.bonusCents, r.orders, r.onlineMin]
              .concat([r.notes, r.source, r.editedAt, r.balanceCents])
              .map(String)
              .join(','),
          );
      expect(pick(1)).toEqual([
        'doordash,3000,500,250,7,180,busy night,manual,11,3750',
        'other,0,0,0,2,null,null,manual,13,0',
        'ubereats,800,0,0,null,null,null,manual,12,800',
      ]);
      expect(pick(2)).toEqual(['skipthedishes,4500,120,0,null,null,null,import,14,4620']);
      // Only amounts above zero became entries; each carries the row's edit time.
      expect(
        db.prepare('SELECT type, amount_cents, created_at FROM earning_entries ORDER BY id').all(),
      ).toEqual([
        { type: 'fare', amount_cents: 3000, created_at: 11 },
        { type: 'fare', amount_cents: 800, created_at: 12 },
        { type: 'fare', amount_cents: 4500, created_at: 14 },
        { type: 'tip', amount_cents: 500, created_at: 11 },
        { type: 'tip', amount_cents: 120, created_at: 14 },
        { type: 'bonus', amount_cents: 250, created_at: 11 },
      ]);
      const eff = repo.effective(1, '2026-01-01', '2026-01-31', opts);
      expect(eff.reduce((a, r) => a + totalOf(r), 0)).toBe(3750 + 800 + 0 + 4620);
      expect(eff.find((r) => r.platform === 'other')).toMatchObject({ grossCents: 0, orders: 2 });

      const cols = db
        .prepare('SELECT name FROM pragma_table_info(?)')
        .pluck()
        .all('shift_earnings');
      expect(cols).not.toContain('gross_cents');
      db.prepare('DELETE FROM shifts WHERE id = 2').run();
      expect(db.prepare('SELECT count(*) FROM earning_entries').pluck().get()).toBe(4); // shift 2's fare and tip went with it
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('entries', () => {
  let h: Harness;
  afterEach(() => h.close());

  async function endedShift() {
    h = harness();
    const { cookie } = await h.signUp();
    const send = (method: string, url: string, payload?: object) =>
      h.call(method, url, payload, { cookie });
    await send('POST', '/vehicles', { name: 'Civic', kind: 'car' });
    const created = await send('POST', '/shifts', {
      client_id: '0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e11',
      vehicle_id: 1,
      started_at: h.clock.t,
    });
    const id = created.json().id as number;
    h.db
      .prepare("UPDATE shifts SET status = 'ended', ended_at = ?, total_m = 1000 WHERE id = ?")
      .run(h.clock.t + 3_600_000, id);
    const date = h.db
      .prepare('SELECT local_date FROM shifts WHERE id = ?')
      .pluck()
      .get(id) as string;
    return { id, send, date, repo: createEarningsRepository(h.db) };
  }

  test('the database refuses a wrong sign and a zero', async () => {
    const { id, repo } = await endedShift();
    const row = { userId: 1, shiftId: id, platform: 'grab', editedAt: 1 };
    const add = (type: Parameters<typeof repo.addEntry>[1]['type'], amountCents: number) =>
      repo.addEntry(row, { type, amountCents, note: null });
    expect(() => add('commission', 100)).toThrow(/CHECK/);
    expect(() => add('fare', -100)).toThrow(/CHECK/);
    expect(() => add('payout', 0)).toThrow(/CHECK/);
    expect(() => add('adjustment', 0)).toThrow(/CHECK/);
    expect(add('adjustment', -50)).toBeGreaterThan(0);
    expect(add('top_up', 50)).toBeGreaterThan(0);
  });

  test('a cash trip: earnings after the commission, the driver owes the app, a top-up clears it', async () => {
    const { id, send, date, repo } = await endedShift();
    const row = { userId: 1, shiftId: id, platform: 'other', editedAt: 1 };
    repo.addEntry(row, { type: 'fare', amountCents: 10_000, note: 'cash trip' });
    repo.addEntry(row, { type: 'cash_collected', amountCents: -10_000, note: null });
    repo.addEntry(row, { type: 'commission', amountCents: -2_000, note: null });
    repo.addEntry(row, { type: 'tax_withheld', amountCents: -100, note: null });
    expect(repo.find(id, 'other')).toMatchObject({
      grossCents: 10_000,
      feesCents: -2_000,
      taxWithheldCents: -100,
      cashCollectedCents: -10_000,
      balanceCents: -2_100,
    });
    const top = repo.addEntry(row, { type: 'top_up', amountCents: 5_000, note: null });
    expect(repo.find(id, 'other')?.balanceCents).toBe(2_900);
    const [eff] = repo.effective(1, date, date, opts);
    expect([totalOf(eff!), eff!.taxWithheldCents]).toEqual([8_000, -100]);
    // Every consumer reads the same sum: the dashboard shows earnings after the commission.
    const s = (await send('GET', `/summary?from=${date}&to=${date}`)).json();
    expect(s.earnings_cents).toBe(8_000);

    const rowId = repo.find(id, 'other')!.id;
    expect(repo.deleteEntry(rowId, top)).toBe(true);
    expect(repo.deleteEntry(rowId + 1, top)).toBe(false); // only an entry of that row
    expect(repo.entriesOf(rowId).map((e) => e.type)).toEqual([
      'fare',
      'cash_collected',
      'commission',
      'tax_withheld',
    ]);
  });

  test('the PUT of today keeps other types and an unchanged split, and replaces a changed amount', async () => {
    const { id, send, repo } = await endedShift();
    const row = { userId: 1, shiftId: id, platform: 'other', editedAt: 1 };
    repo.addEntry(row, { type: 'fare', amountCents: 600, note: 'trip 1' });
    repo.addEntry(row, { type: 'fare', amountCents: 400, note: 'trip 2' });
    repo.addEntry(row, { type: 'commission', amountCents: -250, note: null });
    const types = () =>
      repo.entriesOf(repo.find(id, 'other')!.id).map((e) => [e.type, e.amountCents]);

    let r = await send('PUT', `/shifts/${id}/earnings/other`, {
      gross_cents: 1000,
      tips_cents: 90,
    });
    expect(r.statusCode).toBe(200);
    expect(types()).toEqual([
      ['fare', 600],
      ['fare', 400],
      ['commission', -250],
      ['tip', 90],
    ]);
    expect(r.json().effective[0].total_cents).toBe(840);

    r = await send('PUT', `/shifts/${id}/earnings/other`, { gross_cents: 1200 });
    expect(types()).toEqual([
      ['commission', -250],
      ['fare', 1200],
    ]);
    expect(r.json().entries[0]).toMatchObject({ gross_cents: 1200, tips_cents: 0 });
  });
});
