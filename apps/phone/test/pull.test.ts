import { describe as d } from '../src/screens/ShiftDetailScreen';
import { json, makeServices, mockServer, problem, type Handler } from './support/mock';
import { ID } from './support/shiftKit';

const shiftData = (over: Record<string, unknown> = {}) => ({
  id: 5,
  client_id: ID,
  vehicle_id: 3,
  status: 'ended',
  started_at: 1_000,
  ended_at: 9_000,
  local_date: '2026-11-01',
  segmenter: 'whole_shift',
  total_m: 5000,
  active_m: 5000,
  deadhead_m: 0,
  personal_m: 0,
  calc_version: 1,
  notes: null,
  updated_at: 100,
  recon_status: 'match',
  recon_reasons: [],
  ...over,
});
const tripData = (over: Record<string, unknown> = {}) => ({
  id: 8,
  shift_id: 5,
  trip_key: `${ID}:1000:active`,
  kind: 'active',
  original_kind: 'active',
  source: 'auto',
  started_at: 1_000,
  ended_at: 9_000,
  distance_m: 5000,
  purpose: '',
  edited_at: null,
  ...over,
});
type Entry = { seq: number; entity: string; op: string; key: string; data?: unknown };
const entry = (seq: number, entity: string, op: string, key: string, data?: unknown): Entry => ({
  seq,
  entity,
  op,
  key,
  data: data ?? null,
});

function feed(pages: { changes: Entry[]; next_cursor: number; has_more: boolean }[]) {
  const queue = [...pages];
  const urls: string[] = [];
  const routes: Record<string, Handler> = {
    'GET /sync/changes': (r) => {
      urls.push(r.url);
      return json(200, queue.shift() ?? { changes: [], next_cursor: 0, has_more: false });
    },
  };
  return { routes, urls, queue };
}

async function phone(routes: Record<string, Handler>, paired: object | boolean = true) {
  const server = mockServer(routes);
  const ctx = makeServices(server.fetch, { paired, newId: () => ID, now: () => 50_000 });
  const { services } = ctx;
  await services.shifts.begin({
    clientId: ID,
    vehicleId: 3,
    segmenter: 'whole_shift',
    startedAt: 1_000,
    timeZone: 'UTC',
  });
  await services.shifts.finish({ clientId: ID, endedAt: 9_000, result: null, manifest: null });
  return { ...ctx, server };
}

describe('pull (GET /sync/changes)', () => {
  it('inserts what the phone has not seen, keeps the cursor and pages until done', async () => {
    const f = feed([
      {
        changes: [
          entry(1, 'vehicle', 'upsert', '3', {
            id: 3,
            name: 'Civic',
            kind: 'car',
            archived_at: null,
          }),
        ],
        next_cursor: 1,
        has_more: true,
      },
      {
        changes: [
          entry(
            2,
            'shift',
            'upsert',
            'aaaa',
            shiftData({ client_id: 'aaaa', id: 6, deduction_cents: 350 }),
          ),
          entry(
            3,
            'trip',
            'upsert',
            'aaaa:1:active',
            tripData({ shift_id: 6, trip_key: 'aaaa:1:active' }),
          ),
          entry(4, 'settings', 'upsert', 'settings', {
            country: 'CA',
            distance_unit: 'km',
            currency: 'CAD',
            timezone: 'UTC',
            stops_enabled: false,
            engine_version: 1,
            diagnostics: { level: 'off', verbose_until: null },
            modules: { sync: true },
            region: 'ON',
            own_mileage_rate: null,
            mileage_rate: 'official',
          }),
        ],
        next_cursor: 4,
        has_more: false,
      },
    ]);
    const { services, server, plain } = await phone(f.routes);
    expect(await services.puller.pull({ force: true })).toEqual({ state: 'ok', applied: 4 });
    expect(f.urls[0]).toContain('after=0');
    expect(f.urls[1]).toContain('after=1');
    expect(await services.shifts.get('aaaa')).toMatchObject({
      server_id: 6,
      sync_state: 'on_server',
      calc_source: 'server',
      total_m: 5000,
      server_deduction_cents: 350,
      server_deduction_known: 1,
    });
    expect((await services.shifts.trips('aaaa')).map((t) => t.trip_key)).toEqual(['aaaa:1:active']);
    expect(JSON.parse(plain.data.get('pairing.settings')!)).toMatchObject({
      country: 'CA',
      region: 'ON',
      mileage_rate: 'official',
    });
    await services.puller.pull({ force: true });
    expect(server.calls.at(-1)!.url).toContain('after=4');
  });

  it('a web recompute replaces the number, and the phone figure goes to the diff list', async () => {
    const f = feed([
      {
        changes: [
          entry(
            1,
            'shift',
            'upsert',
            ID,
            shiftData({ total_m: 4900, active_m: 4900, deduction_cents: null }),
          ),
        ],
        next_cursor: 1,
        has_more: false,
      },
    ]);
    const { services } = await phone(f.routes);
    await services.shifts.applyEnd(
      ID,
      { id: 5, total_m: 5000, active_m: 5000, deadhead_m: 0, personal_m: 0, calc_version: 1 },
      { status: 'match', reasons: [] },
    );
    await services.puller.pull({ force: true });
    // A null deduction from the server (no rate, or actual expenses) is known, not missing.
    expect(await services.shifts.get(ID)).toMatchObject({
      total_m: 4900,
      calc_source: 'server',
      server_deduction_cents: null,
      server_deduction_known: 1,
    });
    const [diff] = await services.shifts.conflicts(ID);
    expect(diff).toMatchObject({ reason: 'recon_diff' });
    expect(d(diff!, 'km')).toMatch(
      /Server confirmed 4\.9 km\. Your phone showed 5\.0 km \(0\.1 km difference\)/,
    );
    await services.shifts.markSeen(diff!.id);
    expect(await services.shifts.conflicts(ID)).toEqual([]);
  });

  it('LWW on a pending shift edit: older loses and is logged, strictly newer is kept, ties go to the server', async () => {
    for (const [phoneAt, wins] of [
      [50, false],
      [100, false],
      [150, true],
    ] as const) {
      const f = feed([
        {
          changes: [entry(1, 'shift', 'upsert', ID, shiftData({ notes: 'web', updated_at: 100 }))],
          next_cursor: 1,
          has_more: false,
        },
      ]);
      const { services } = await phone(f.routes);
      await services.outbox.enqueue('shift.patch', ID, { notes: 'phone', updated_at: phoneAt });
      await services.puller.pull({ force: true });
      expect((await services.shifts.get(ID))!.notes).toBe(wins ? null : 'web');
      expect(
        (await services.outbox.pending()).filter((i) => i.kind === 'shift.patch'),
      ).toHaveLength(wins ? 1 : 0);
      expect((await services.shifts.conflicts(ID)).map((c) => c.reason)).toEqual(
        wins ? [] : ['superseded_by_server'],
      );
    }
  });

  it('a shift whose end the phone has not sent is not overwritten by the feed', async () => {
    const f = feed([
      {
        changes: [
          entry(
            1,
            'shift',
            'upsert',
            ID,
            shiftData({ status: 'active', total_m: null, ended_at: null }),
          ),
        ],
        next_cursor: 1,
        has_more: false,
      },
    ]);
    const { services } = await phone(f.routes);
    await services.shifts.setSyncState(ID, 'local');
    await services.outbox.enqueue('shift.end', ID, { ended_at: 9_000 });
    await services.puller.pull({ force: true });
    expect(await services.shifts.get(ID)).toMatchObject({
      status: 'ended',
      server_id: 5,
      sync_state: 'local',
    });
  });

  it('a purge on the web removes the shift, and unsent edits are logged and never re-sent', async () => {
    const f = feed([
      { changes: [entry(1, 'shift', 'delete', ID)], next_cursor: 1, has_more: false },
    ]);
    const { services } = await phone(f.routes);
    await services.shifts.applyEnd(
      ID,
      { id: 5, total_m: 0, active_m: 0, deadhead_m: 0, personal_m: 0, calc_version: 1 },
      null,
    );
    await services.outbox.enqueue('shift.patch', ID, { notes: 'x', updated_at: 5 });
    await services.puller.pull({ force: true });
    expect(await services.shifts.get(ID)).toBeNull();
    expect((await services.outbox.counts()).pending).toBe(0);
    expect((await services.shifts.conflicts(ID)).map((c) => c.reason)).toEqual([
      'deleted_on_server',
    ]);
  });

  it('trip tombstones remove the local trip; orphaned overrides are reported, not dropped', async () => {
    const key = `${ID}:1000:active`;
    const f = feed([
      { changes: [entry(1, 'trip', 'upsert', key, tripData())], next_cursor: 1, has_more: false },
      {
        changes: [
          entry(2, 'override', 'orphaned_override', key, {
            trip_key: key,
            kind: 'personal',
            purpose: 'x',
            edited_at: 9,
          }),
          entry(3, 'trip', 'delete', key),
        ],
        next_cursor: 3,
        has_more: false,
      },
    ]);
    const { services } = await phone(f.routes);
    await services.puller.pull({ force: true });
    expect(await services.shifts.trips(ID)).toHaveLength(1);
    await services.puller.pull({ force: true });
    expect(await services.shifts.trips(ID)).toEqual([]);
    expect(d((await services.shifts.conflicts(ID))[0]!, 'km')).toMatch(/could not be applied/);
  });

  it('410 cursor_expired pulls the whole window again and deletes nothing by itself', async () => {
    let n = 0;
    const urls: string[] = [];
    const { services } = await phone({
      'GET /sync/changes': (r) => {
        urls.push(r.url);
        return ++n === 2
          ? problem(410, 'cursor_expired')
          : json(200, { changes: [], next_cursor: 7, has_more: false });
      },
    });
    await services.puller.pull({ force: true });
    expect((await services.puller.pull({ force: true })).state).toBe('ok');
    expect(urls.map((u) => /after=(\d+)/.exec(u)![1])).toEqual(['0', '7', '0']);
    expect(await services.shifts.get(ID)).not.toBeNull();
  });

  it('is skipped when the sync module is off, when paired state is missing and within the interval; offline is not an error', async () => {
    const f = feed([]);
    const off = await phone(f.routes, { modules: { sync: false, tracking: true } });
    expect((await off.services.puller.pull({ force: true })).state).toBe('disabled');
    expect(off.server.calls).toHaveLength(0);

    const down = await phone({ 'GET /sync/changes': () => problem(503, 'x', true) });
    expect((await down.services.puller.pull({ force: true })).state).toBe('offline');
    const revoked = await phone({ 'GET /sync/changes': () => problem(401, 'device_revoked') });
    expect((await revoked.services.puller.pull({ force: true })).state).toBe('halted');

    const ok = await phone(feed([{ changes: [], next_cursor: 1, has_more: false }]).routes);
    await ok.services.puller.pull();
    expect((await ok.services.puller.pull()).state).toBe('skipped');
  });
});
