import { describe, expect, test } from 'vitest';
import {
  crashMessage,
  diagKindNames,
  noopDiagnostics,
  validateEvent,
  type DiagKind,
} from '../src/index';

const ID = '0b9f3c1e-5a4d-4e0b-9a55-3f6a1c2d7e10';

/** One valid `data` per kind. */
// prettier-ignore
const samples: Record<DiagKind, { src: string; data: Record<string, unknown> }> = {
  'service.event': { src: 'phone_native', data: { event: 'restarted', reason: 'os_kill_inferred', profile: 'normal' } },
  'track.window': { src: 'phone_native', data: { fixes: 580, acc_hist: [400, 120, 50, 10], interval_p50_ms: 1000, interval_max_ms: 9000, still_gated_s: 0, battery_pct: 81, charging: false, temp_dc: 310, thermal: 1 } },
  crash: { src: 'server', data: { runtime: 'server', class: 'SQLITE_BUSY', frames: ['db/open.ts:42'], fatal: true, msg: 'database is locked' } },
  'diag.self': { src: 'phone_js', data: { dropped: { ring_full: 0, schema_reject: 2, level_off: 0, disk_low: 0 }, pending: 3, ring_kb: 40, cpu_ms_per_h: 120, writes_per_h: 6 } },
};

const event = (kind: DiagKind, data: unknown = samples[kind].data, extra = {}) => ({
  kind,
  at: 1_767_000_000_000,
  level: 'basic',
  src: samples[kind].src,
  seq: 7,
  shift: ID,
  v: '0.1.0',
  data,
  ...extra,
});

/** Calls `visit` once per string leaf, with a copy of the data where only that leaf is replaced. */
function eachStringLeaf(data: unknown, visit: (replaced: (v: string) => unknown) => void) {
  const walk = (node: unknown, rebuild: (v: unknown) => unknown) => {
    if (typeof node === 'string') visit((v) => rebuild(v));
    else if (Array.isArray(node)) node.forEach((x, i) => walk(x, (v) => rebuild(node.with(i, v))));
    else if (node && typeof node === 'object') {
      for (const [k, x] of Object.entries(node)) walk(x, (v) => rebuild({ ...node, [k]: v }));
    }
  };
  walk(data, (v) => v);
}

// A payout such as `12.34` or `1234` cannot be told from a version or a count, so the defence for
// money is that no kind declares a money field; the other canaries of 16 section 4.4 are below.
// `CANARY_NOTE`/`CANARY_BIKE` look like identifiers, so pattern fields cannot refuse them; they are
// refused where they would matter: enum fields, undeclared fields and free-text slots (tests below).
// prettier-ignore
const CANARIES = ['43.6532', '-79.3832', '436532000', '-793832000', '123 CANARY ST', 'canary.ts.net', 'mwd_canary', 'mwp_canary', 'mw_session=canary'];

describe('diagnostics event schemas', () => {
  test('every kind accepts its valid sample and is in the catalogue', () => {
    expect(diagKindNames.sort()).toEqual(Object.keys(samples).sort());
    for (const kind of diagKindNames) {
      expect(validateEvent(event(kind)), kind).toMatchObject({ ok: true });
    }
  });

  test('canaries in any string field are rejected, so none reaches a stored event', () => {
    for (const kind of diagKindNames) {
      // `crash.msg` is the one sanctioned text slot: gated by class, redacted by crashMessage (below).
      const fields = { ...samples[kind].data, msg: undefined };
      eachStringLeaf(fields, (replaced) => {
        for (const canary of CANARIES) {
          const result = validateEvent(event(kind, replaced(canary)));
          if (result.ok)
            expect(JSON.stringify(result.event), `${kind} ${canary}`).not.toContain(canary);
        }
      });
    }
    // Coordinate-like text is refused even where the pattern would otherwise allow it.
    for (const bad of ['43.6532', '-79.3832', '436532000']) {
      expect(validateEvent(event('diag.self', undefined, { v: bad })).ok).toBe(false);
    }
  });

  test('undeclared fields carrying coordinates or free text are rejected at any depth', () => {
    for (const kind of diagKindNames) {
      for (const extra of [{ lat: 43.6532 }, { note: 'CANARY_NOTE' }, { address: '1 CANARY ST' }]) {
        const data = { ...samples[kind].data, ...extra };
        expect(validateEvent(event(kind, data)).ok, kind).toBe(false);
      }
    }
    const nested = { ...samples['diag.self'].data, dropped: { ring_full: 0, lat_e7: 436532000 } };
    expect(validateEvent(event('diag.self', nested)).ok).toBe(false);
    expect(validateEvent(event('diag.self', undefined, { lat: 43.6532 })).ok).toBe(false);
  });

  test('free text in an enum field and non-integers in a number field are rejected', () => {
    const service = { ...samples['service.event'].data, reason: 'CANARY_NOTE' };
    expect(validateEvent(event('service.event', service)).ok).toBe(false);
    const window = { ...samples['track.window'].data, fixes: 43.6532 };
    expect(validateEvent(event('track.window', window)).ok).toBe(false);
  });

  test('bounds, envelope and source are enforced; reasons never repeat the value', () => {
    expect(validateEvent({ ...event('crash'), kind: 'nope' }).ok).toBe(false);
    expect(validateEvent({ ...event('service.event'), src: 'server' }).ok).toBe(false);
    expect(
      validateEvent(event('track.window', { ...samples['track.window'].data, thermal: 9 })).ok,
    ).toBe(false);
    expect(validateEvent(event('diag.self', undefined, { shift: 'CANARY_NOTE' })).ok).toBe(false);
    const bad = validateEvent(
      event('service.event', { ...samples['service.event'].data, reason: 'CANARY_NOTE' }),
    );
    expect(JSON.stringify(bad)).not.toContain('CANARY_NOTE');
    expect(validateEvent('x').ok).toBe(false);
  });

  test('a crash message is accepted only for allowlisted classes, and is redacted', () => {
    const other = { ...samples.crash.data, class: 'TypeError', msg: 'bad value 43.6532' };
    expect(validateEvent(event('crash', other)).ok).toBe(false);
    const withheld = { ...samples.crash.data, class: 'TypeError', msg: undefined };
    expect(validateEvent(event('crash', withheld)).ok).toBe(true);
    expect(crashMessage('TypeError', 'at 43.6532')).toBeUndefined();
    expect(crashMessage('SQLITE_CONSTRAINT', 'bound 43.6532 and -79.3832 at 436532000 ok')).toBe(
      'bound [redacted] and [redacted] at [redacted] ok',
    );
    expect(crashMessage('SQLITE_BUSY', 'x'.repeat(300))).toHaveLength(120);
  });
});

describe('DiagnosticsPort', () => {
  test('the no-op port accepts anything, returns nothing and is frozen', () => {
    expect(noopDiagnostics.record('crash', { anything: 'CANARY_NOTE' })).toBeUndefined();
    expect(Object.isFrozen(noopDiagnostics)).toBe(true);
  });
});
