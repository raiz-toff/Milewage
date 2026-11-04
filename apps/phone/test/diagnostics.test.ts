import { validateEvent, type DiagEvent } from '@milewage/shared';
import {
  BATCH_MAX,
  installCrashHandler,
  PhoneDiagnostics,
  RING_CAP,
} from '../src/diagnostics/phoneDiagnostics';
import { MemoryStore } from '../src/pairing/pairing';
import { json, problem, SETTINGS } from './support/mock';
import { ID, server, setup } from './support/shiftKit';

const settings = (level: 'off' | 'basic' | 'verbose', over: Record<string, unknown> = {}) => ({
  diagnostics: { level, verbose_until: null as number | null },
  modules: { diagnostics: true } as Record<string, boolean>,
  ...over,
});

function make(now = () => 1_700_000_000_000) {
  const store = new MemoryStore();
  const diag = new PhoneDiagnostics({ store, appVersion: '0.1.0', now });
  return { diag, store };
}

const STATS = {
  attempts: 4,
  ok: 3,
  fail_net: 1,
  fail_4xx: 0,
  fail_5xx: 0,
  fail_429: 0,
  fail_507: 0,
  bytes_gz: 2048,
  durations_ms: [120, 80, 300, 90],
};

// What 16 section 4.1 forbids anywhere in an event's data.
const COORD = /-?\d{1,3}\.\d{4,}|(?<![0-9A-Za-z])\d{9,}(?![0-9A-Za-z])/;
const SECRET = /mw[dp]_|mw_session|\.ts\.net/i;
const leaks = (events: readonly DiagEvent[]) =>
  events.filter((e) => COORD.test(JSON.stringify(e.data)) || SECRET.test(JSON.stringify(e.data)));

describe('levels', () => {
  it('off records nothing and counts level_off; basic records basic kinds', () => {
    const { diag } = make();
    diag.applySettings(settings('off'));
    diag.recordUploadWindow(STATS, 0, 0);
    expect(diag.size).toBe(0);
    diag.applySettings(settings('basic'));
    diag.recordUploadWindow(STATS, 3, 12);
    expect(diag.size).toBe(1);
    expect(diag.snapshot()[0]).toMatchObject({
      kind: 'upload.window',
      src: 'phone_js',
      level: 'basic',
      seq: 1,
      v: '0.1.0',
      data: { attempts: 4, fail_net: 1, dur_p95_ms: 300, pending_points: 3, oldest_pending_s: 12 },
    });
  });

  it('switching to off or turning the module off deletes unsent rows', () => {
    const { diag } = make();
    diag.applySettings(settings('basic'));
    diag.recordUploadWindow(STATS, 0, 0);
    diag.applySettings(settings('off'));
    expect(diag.size).toBe(0);
    diag.applySettings(settings('basic'));
    diag.recordUploadWindow(STATS, 0, 0);
    diag.applySettings(settings('verbose', { modules: { diagnostics: false } }));
    expect(diag.effectiveLevel).toBe('off');
    expect(diag.size).toBe(0);
  });

  it('verbose reverts to basic when its expiry passes, by the phone clock', () => {
    let t = 1_000;
    const { diag } = make(() => t);
    diag.applySettings({
      ...settings('verbose'),
      diagnostics: { level: 'verbose', verbose_until: 5_000 },
    });
    expect(diag.effectiveLevel).toBe('verbose');
    t = 5_000;
    expect(diag.effectiveLevel).toBe('basic');
  });

  it('an unknown kind or a stray field is rejected, counted, and not kept', () => {
    const { diag } = make();
    diag.applySettings(settings('basic'));
    diag.record('bogus' as never, {});
    diag.record('upload.window', { ...STATS, lat_e7: 377749290 } as never);
    expect(diag.size).toBe(0);
    diag.recordSelf();
    expect(diag.snapshot()[0]!.data).toMatchObject({ dropped: { schema_reject: 2 } });
  });
});

describe('allowlist canary: no coordinates or credentials in any event', () => {
  it('hostile inputs are rejected or redacted before they reach the ring', () => {
    const { diag } = make();
    diag.applySettings(settings('basic'));
    diag.shiftClientId = ID;
    const device = (model: string) => ({
      make: 'Samsung',
      model,
      android: '14',
      sdk: 34,
    });
    const base = { app_v: '0.1.0', native_v: '0.1.0', engine_v: '1', api_v: '1' };
    // Every free-text-ish slot gets a coordinate, an E7 value, an address or a token.
    for (const model of ['37.7749290,-122.4194160', '123 Main St', '377749290', 'mwd_abcdefghij']) {
      diag.record('app.start', { ...base, device: device(model) });
    }
    diag.record('app.start', { ...base, app_v: '37.7749290', device: device('SM-S928B') });
    diag.record('app.start', { ...base, device: { ...device('SM-S928B'), lat: 37.7749 } } as never);
    diag.record('crash', {
      runtime: 'js',
      class: 'Error',
      frames: ['fn at 37.7749290', 'ok.fn'],
      fatal: true,
    });
    diag.record('crash', {
      runtime: 'js',
      class: 'Error',
      frames: ['ok.fn'],
      fatal: true,
      msg: 'near 37.7749290 -122.4194160', // class is not on the allowlist: msg must be refused
    });
    diag.recordCrash(new Error('driver at 37.7749290,-122.4194160 token mwd_secretsecret'), true);
    const own = new Error('lat 37.7749290 lon -122.4194160 host box.tail1234.ts.net');
    own.name = 'MilewageStoreError';
    diag.recordCrash(own, false);
    diag.recordCrash({ weird: 'object 377749290' }, false);

    const stored = diag.snapshot();
    expect(stored.length).toBeGreaterThan(0);
    expect(leaks(stored)).toEqual([]);
    // The own-class message is kept but redacted.
    const kept = stored.find((e) => e.kind === 'crash' && e.data.class === 'MilewageStoreError')!;
    expect(String(kept.data.msg)).toContain('[redacted]');
    // Every stored event validates again under the shared schema (what the server will do).
    for (const e of stored) expect(validateEvent(e).ok).toBe(true);
    // The plain Error crash has no message at all.
    const plain = stored.filter((e) => e.kind === 'crash' && e.data.class === 'Error');
    expect(plain.every((e) => e.data.msg === undefined)).toBe(true);
    diag.recordSelf();
    const dropped = (diag.snapshot().at(-1)!.data as { dropped: { schema_reject: number } })
      .dropped;
    expect(dropped.schema_reject).toBeGreaterThanOrEqual(6);
  });

  it('crash frames keep function names only, never file paths or lines', () => {
    const { diag } = make();
    diag.applySettings(settings('basic'));
    const e = new Error('x');
    e.stack =
      'Error: x\n    at doThing (/data/user/0/app/index.android.bundle:1:2345)\n    at anonymous (native)\n    at <anonymous>';
    diag.recordCrash(e, true);
    const frames = diag.snapshot()[0]!.data.frames as string[];
    expect(frames).toEqual(['doThing', 'anonymous', '<anonymous>']);
  });

  it('the global handler records the crash and still calls the previous handler', () => {
    const { diag } = make();
    diag.applySettings(settings('basic'));
    const previous = jest.fn();
    let installed: ((e: unknown, fatal?: boolean) => void) | undefined;
    installCrashHandler(diag, {
      getGlobalHandler: () => previous,
      setGlobalHandler: (h) => {
        installed = h;
      },
    });
    installed!(new TypeError('boom'), true);
    expect(diag.snapshot()[0]).toMatchObject({
      kind: 'crash',
      data: { fatal: true, class: 'TypeError' },
    });
    expect(previous).toHaveBeenCalledTimes(1);
    expect(() => installCrashHandler(diag, undefined)).not.toThrow();
  });
});

describe('ring', () => {
  it('stays within the cap, drops the cheap kinds first and counts it', () => {
    const { diag } = make();
    diag.applySettings(settings('basic'));
    diag.recordAppStart({
      nativeV: '1',
      engineV: '1',
      apiV: '1',
      device: { make: 'Samsung', model: 'SM-S928B', android: '14', sdk: 34 },
    });
    for (let i = 0; i < RING_CAP + 20; i++) diag.recordUploadWindow(STATS, i, 0);
    expect(diag.size).toBe(RING_CAP);
    expect(diag.snapshot().some((e) => e.kind === 'app.start')).toBe(true);
    diag.recordSelf();
    const self = diag.snapshot().at(-1)!.data as { dropped: { ring_full: number } };
    expect(self.dropped.ring_full).toBeGreaterThanOrEqual(21);
  });

  it('persists the ring and the sequence across a restart', async () => {
    const { diag, store } = make();
    diag.applySettings(settings('basic'));
    diag.recordUploadWindow(STATS, 0, 0);
    await diag.persist();
    const again = new PhoneDiagnostics({ store, appVersion: '0.1.0' });
    await again.load();
    expect(again.size).toBe(1);
    again.applySettings(settings('basic'));
    again.recordUploadWindow(STATS, 0, 0);
    expect(again.snapshot().map((e) => e.seq)).toEqual([1, 2]);
  });
});

describe('sending', () => {
  const phone = (over = {}) => {
    const routes = server({
      'POST /diagnostics/events': () =>
        json(200, { accepted: 1, duplicates: 0, discarded: 0, rejected: [] }),
      ...over,
    });
    return { ...setup(routes), routes };
  };
  const posts = (r: ReturnType<typeof phone>) =>
    r.routes.calls.filter((c) => c.path === '/diagnostics/events');

  it('a window sends upload.window and diag.self gzip and deletes what was sent', async () => {
    const p = phone();
    await p.services.pairing.refreshSettings((await p.services.pairing.load())!);
    p.tracker.start(ID);
    await p.services.diagnosticsWindow();
    await p.services.diagnosticsWindow();
    const sent = posts(p);
    expect(sent.length).toBeGreaterThan(0);
    const body = sent[0]!.body as { events: DiagEvent[] };
    expect(sent[0]!.headers['Content-Encoding']).toBe('gzip');
    expect(body.events.map((e) => e.kind)).toContain('upload.window');
    expect(p.services.diagnostics.size).toBeLessThanOrEqual(2);
  });

  it('is not sent while telemetry is waiting (tax data first)', async () => {
    const p = phone();
    p.services.diagnostics.applySettings(SETTINGS);
    p.tracker.start(ID);
    p.tracker.emit({ recordedAt: 1000 });
    await p.services.diagnosticsWindow();
    expect(posts(p)).toHaveLength(0);
    expect(p.services.diagnostics.size).toBeGreaterThan(0);
  });

  it('404 means the module is off on the server: behave as off and clear', async () => {
    const p = phone({ 'POST /diagnostics/events': () => problem(404, 'not_found') });
    p.services.diagnostics.applySettings(SETTINGS);
    p.services.diagnostics.recordUploadWindow(STATS, 0, 0);
    const s = (await p.services.pairing.session())!;
    expect(await p.services.diagnostics.flush(s.client)).toBe('module_off');
    expect(p.services.diagnostics.size).toBe(0);
    expect(p.services.diagnostics.effectiveLevel).toBe('off');
  });

  it('503 keeps the ring for a retry; 422 drops the bad batch; batches are at most 200', async () => {
    let status = 503;
    const p = phone({
      'POST /diagnostics/events': () =>
        status === 200
          ? json(200, { accepted: 200, duplicates: 0, discarded: 0, rejected: [] })
          : problem(status, 'x', status === 503),
    });
    p.services.diagnostics.applySettings(SETTINGS);
    for (let i = 0; i < 250; i++) p.services.diagnostics.recordUploadWindow(STATS, i, 0);
    const s = (await p.services.pairing.session())!;
    expect(await p.services.diagnostics.flush(s.client)).toBe('retry');
    expect(p.services.diagnostics.size).toBe(250);
    status = 200;
    expect(await p.services.diagnostics.flush(s.client)).toBe('sent');
    expect(p.services.diagnostics.size).toBe(250 - BATCH_MAX);
    const raw = posts(p).at(-1)!.body as { events: unknown[] };
    expect(raw.events).toHaveLength(BATCH_MAX);
    status = 422;
    expect(await p.services.diagnostics.flush(s.client)).toBe('sent');
    expect(p.services.diagnostics.size).toBe(0);
  });

  it('app.start carries versions and the device, validated by the shared schema', async () => {
    const p = phone();
    await p.services.pairing.refreshSettings((await p.services.pairing.load())!);
    await p.services.startDiagnostics();
    await p.services.startDiagnostics(); // once per process
    const starts = p.services.diagnostics.snapshot().filter((e) => e.kind === 'app.start');
    expect(starts).toHaveLength(1);
    expect(starts[0]!.data).toMatchObject({ api_v: '1', device: { make: 'unknown' } });
  });
});
