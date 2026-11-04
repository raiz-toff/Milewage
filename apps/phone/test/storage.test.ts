import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SqliteKeyValueStore, type SqlDb } from '../src/storage/sqliteStore';
import { AndroidPermissions, P } from '../src/permissions/android';
import { ID, drive, server, setup } from './support/shiftKit';
import { openNodeDb } from './support/nodeSql';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mw-kv-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const file = () => join(dir, 'kv.db');
/** A store over a file; `close` ends the "process". */
function openStore() {
  const db = openNodeDb(file());
  return { store: new SqliteKeyValueStore(async () => db), close: () => db.close() };
}

describe('SqliteKeyValueStore', () => {
  it('stores, overwrites, removes and reads missing keys as null', async () => {
    const { store, close } = openStore();
    expect(await store.get('a')).toBeNull();
    await store.set('a', '1');
    await store.set('a', '2');
    expect(await store.get('a')).toBe('2');
    await store.remove('a');
    expect(await store.get('a')).toBeNull();
    await store.remove('never-there');
    close();
  });

  it('keeps values across a restart (close and reopen the file)', async () => {
    const first = openStore();
    await first.store.set('shift.active', '{"clientId":"x"}');
    first.close();
    const second = openStore();
    expect(await second.store.get('shift.active')).toBe('{"clientId":"x"}');
    second.close();
  });

  it('holds a diagnostics-ring sized value (a few MB)', async () => {
    const { store, close } = openStore();
    const big = JSON.stringify(
      Array.from({ length: 8000 }, (_, i) => ({ i, pad: 'x'.repeat(300) })),
    );
    expect(big.length).toBeGreaterThan(2_000_000);
    await store.set('diag.ring', big);
    expect(await store.get('diag.ring')).toBe(big);
    close();
  });

  it('retries opening after a failure instead of staying broken', async () => {
    let attempts = 0;
    const store = new SqliteKeyValueStore(async (): Promise<SqlDb> => {
      if (++attempts === 1) throw new Error('disk busy');
      return openNodeDb();
    });
    await expect(store.get('a')).rejects.toThrow('disk busy');
    await store.set('a', 'ok');
    expect(await store.get('a')).toBe('ok');
  });
});

describe('what survives a restart', () => {
  it('the active shift: a new controller over the same store resumes it and re-attaches', async () => {
    const first = openStore();
    const a = setup(server(), { paired: true, plain: first.store });
    await a.services.shift.start({ vehicleId: 3 });
    first.close();

    const second = openStore();
    const b = setup(server(), { paired: true, plain: second.store });
    expect(b.services.shift.current).toBeNull();
    const restored = await b.services.shift.load();
    expect(restored).toMatchObject({ clientId: ID, vehicleId: 3, endedAt: null });
    // the live distance is attached again: points that arrive now are counted
    b.tracker.start(ID);
    drive(b.tracker);
    expect(b.services.shift.pump()).toBeGreaterThan(300);
    second.close();
  });

  it('the diagnostics ring and its sequence number', async () => {
    const first = openStore();
    const a = setup(server(), { paired: true, plain: first.store });
    await a.services.diagnostics.load();
    a.services.diagnostics.recordSelf();
    const before = a.services.diagnostics.size;
    expect(before).toBeGreaterThan(0);
    await a.services.diagnostics.persist();
    first.close();

    const second = openStore();
    const b = setup(server(), { paired: true, plain: second.store });
    await b.services.diagnostics.load();
    expect(b.services.diagnostics.size).toBe(before);
    second.close();
  });

  it('a blocked permission is remembered, so it does not read as never asked', async () => {
    const api = {
      sdk: 34,
      check: async () => false,
      request: async () => 'never_ask_again' as const,
      shouldShowRationale: async () => false,
      openSettings: async () => {},
    };
    const first = openStore();
    await new AndroidPermissions({ api, store: first.store }).request('foreground');
    first.close();
    const second = openStore();
    const snap = await new AndroidPermissions({ api, store: second.store }).snapshot();
    expect(snap.foregroundLocation).toBe('blocked');
    expect(P.fine).toContain('FINE');
    second.close();
  });
});
