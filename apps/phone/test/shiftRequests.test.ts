import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, strFromU8 } from 'fflate';
import { parse } from 'yaml';
import { fromJSONSchema } from 'zod';
import { ApiError } from '../src/api/client';
import {
  encode,
  halvedBatch,
  manualTripOf,
  requestFor,
  type Bodies,
  type ChangeType,
  type ShiftChange,
  type ShiftRequest,
} from '../src/sync/shiftRequests';
import type { TrackerPoint } from '../src/tracker/types';

const A = '11111111-1111-4111-8111-111111111111';
const TRIP = '99999999-9999-4999-8999-999999999999';
const AUTO_TRIP = `${A}:1700000000000:deadhead`;

// Type level: every body is a real type from the contract, not `never` (a wrong path or method in
// `Bodies` would make it `never` and accept nothing, so this line would not compile).
type Never<T> = [T] extends [never] ? true : false;
const typed: { [K in ChangeType]: Never<Bodies[K]> } = {
  'shift.create': false,
  'shift.patch': false,
  'odometer.put': false,
  'trip.override': false,
  'trip.manual': false,
  'shift.end': false,
  'telemetry.batch': false,
};

/**
 * The contract's request schema for one operation, read from openapi.yaml with its references
 * pointing into the generated schemas.json, as a validator.
 */
const shared = join(__dirname, '../../../packages/shared');
const spec = parse(readFileSync(join(shared, 'openapi/openapi.yaml'), 'utf8')) as {
  paths: Record<
    string,
    Record<string, { requestBody?: { content: Record<string, { schema: unknown }> } }>
  >;
};
const defs = (
  JSON.parse(readFileSync(join(shared, 'generated/schemas.json'), 'utf8')) as {
    $defs: Record<string, unknown>;
  }
).$defs;
const template = (path: string) =>
  Object.keys(spec.paths).find((t) =>
    new RegExp(`^${t.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path),
  );
function contract(req: ShiftRequest) {
  const t = template(req.path);
  if (!t) throw new Error(`no path in the contract for ${req.path}`);
  const op = spec.paths[t]![req.method.toLowerCase()];
  const schema = op?.requestBody?.content['application/json']?.schema;
  if (!schema) throw new Error(`no JSON body for ${req.method} ${t}`);
  const local = JSON.parse(JSON.stringify(schema).replaceAll('#/components/schemas/', '#/$defs/'));
  return fromJSONSchema({ ...local, $defs: defs });
}
const accepts = (req: ShiftRequest) => {
  const r = contract(req).safeParse(req.body);
  return r.success ? true : r.error.issues;
};

const point = (seq: number, over: Partial<TrackerPoint> = {}): TrackerPoint => ({
  seq,
  shiftClientId: A,
  recordedAt: 1_700_000_000_000 + seq * 1000,
  latE7: 436_532_000,
  lonE7: -793_832_000,
  accuracyM: 5,
  speedDmps: 120,
  bearingDeg: 90,
  altitudeM: 80,
  ...over,
});

const changes: {
  change: ShiftChange;
  kind: ChangeType;
  key: string;
  method: string;
  path: string;
}[] = [
  {
    change: {
      type: 'shift.create',
      clientId: A,
      vehicleId: 3,
      startedAt: 1_000,
      segmenter: 'stops',
    },
    kind: 'shift.create',
    key: A,
    method: 'POST',
    path: '/shifts',
  },
  {
    change: { type: 'shift.patch', clientId: A, notes: 'Airport run', updatedAt: 2_000 },
    kind: 'shift.patch',
    key: A,
    method: 'PATCH',
    path: `/shifts/${A}`,
  },
  {
    change: {
      type: 'odometer.put',
      clientId: A,
      reading: 'shift_start',
      readingM: 12_345_678.4,
      recordedAt: 1_000,
    },
    kind: 'odometer.put',
    key: `${A}:shift_start`,
    method: 'PUT',
    path: `/shifts/${A}/odometer/shift_start`,
  },
  {
    change: {
      type: 'trip.override',
      tripKey: AUTO_TRIP,
      kind: 'personal',
      purpose: 'Lunch',
      editedAt: 3_000,
    },
    kind: 'trip.override',
    key: AUTO_TRIP,
    method: 'PUT',
    path: `/shifts/${A}/trip-overrides/${encodeURIComponent(AUTO_TRIP)}`,
  },
  {
    change: manualTripOf(
      A,
      {
        trip_key: TRIP,
        kind: 'deadhead',
        started_at: 1_000,
        ended_at: 2_000,
        distance_m: 4_200,
        purpose: 'Back to the zone',
      },
      5_000,
    ),
    kind: 'trip.manual',
    key: `${A}:${TRIP}`,
    method: 'PUT',
    path: `/shifts/${A}/trips/${TRIP}`,
  },
  {
    change: {
      type: 'shift.end',
      clientId: A,
      endedAt: 9_000,
      manifest: { firstSeq: 1, lastSeq: 40, pointCount: 40 },
      phoneResult: {
        calcVersion: 1,
        segmenter: 'stops',
        inputDigest: '0123456789abcdef',
        totalM: 12_000,
        activeM: 8_000,
        deadheadM: 3_000,
        personalM: 1_000,
        tripsCount: 3,
      },
    },
    kind: 'shift.end',
    key: A,
    method: 'POST',
    path: `/shifts/${A}/end`,
  },
  {
    change: {
      type: 'telemetry.batch',
      clientId: A,
      points: [point(1), point(2, { speedDmps: null, bearingDeg: null, altitudeM: null })],
    },
    kind: 'telemetry.batch',
    key: A,
    method: 'POST',
    path: '/telemetry/batch',
  },
];

describe('shift changes: one request each, as the contract says', () => {
  it('covers every change type with a body type from the contract', () => {
    expect(Object.values(typed).every((never) => never === false)).toBe(true);
    expect(new Set(changes.map((c) => c.kind))).toEqual(new Set(Object.keys(typed)));
  });

  it.each(changes)('$kind: route, entity key and a body the contract accepts', (c) => {
    const req = encode(c.change);
    expect(req).toMatchObject({ kind: c.kind, entityKey: c.key, method: c.method, path: c.path });
    expect(accepts(req)).toBe(true);
  });

  it.each(changes.filter((c) => c.kind !== 'telemetry.batch'))(
    '$kind: an outbox row gives back the same request',
    (c) => {
      const req = encode(c.change);
      if (req.kind === 'telemetry.batch') throw new Error('not queued');
      const stored = JSON.parse(
        JSON.stringify({ kind: req.kind, entityKey: req.entityKey, body: req.body }),
      );
      expect(requestFor(stored)).toEqual(req);
    },
  );

  it('the validator refuses what the server refuses (so a pass above means something)', () => {
    const req = encode(changes[0]!.change);
    expect(
      accepts({ ...req, body: { ...req.body, extra: 1 } } as unknown as ShiftRequest),
    ).not.toBe(true);
    const trip = encode(changes[3]!.change);
    expect(
      accepts({ ...trip, body: { ...trip.body, purpose: '' } } as unknown as ShiftRequest),
    ).not.toBe(true);
  });

  it('create: notes only when there are some', () => {
    const base = {
      type: 'shift.create',
      clientId: A,
      vehicleId: 3,
      startedAt: 1,
      segmenter: 'whole_shift',
    } as const;
    expect(encode(base).body).toEqual({
      client_id: A,
      vehicle_id: 3,
      started_at: 1,
      segmenter: 'whole_shift',
    });
    expect(encode({ ...base, notes: null }).body).not.toHaveProperty('notes');
    const kept = encode({ ...base, notes: 'Kept after a restore' });
    expect(kept.body).toMatchObject({ notes: 'Kept after a restore' });
    expect(accepts(kept)).toBe(true);
  });

  it('odometer: whole metres', () => {
    expect(encode(changes[2]!.change).body).toEqual({ reading_m: 12_345_678, recorded_at: 1_000 });
  });

  it('end: only ended_at when the phone has no points and no result of its own', () => {
    const bare = encode({
      type: 'shift.end',
      clientId: A,
      endedAt: 9,
      manifest: null,
      phoneResult: null,
    });
    expect(bare.body).toEqual({ ended_at: 9 });
    expect(accepts(bare)).toBe(true);
    const manifestOnly = encode({
      type: 'shift.end',
      clientId: A,
      endedAt: 9,
      manifest: { firstSeq: 3, lastSeq: 7, pointCount: 5 },
      phoneResult: null,
    });
    expect(manifestOnly.body).toEqual({
      ended_at: 9,
      manifest: { first_seq: 3, last_seq: 7, point_count: 5 },
    });
  });

  it('points: the body goes gzipped, and the gzip is exactly the body', () => {
    const req = encode(changes[6]!.change);
    if (req.kind !== 'telemetry.batch') throw new Error('kind');
    expect(JSON.parse(strFromU8(gunzipSync(req.gzip)))).toEqual(req.body);
    expect(req.body.points[1]).toEqual({
      seq: 2,
      recorded_at: 1_700_000_002_000,
      lat_e7: 436_532_000,
      lon_e7: -793_832_000,
      accuracy_m: 5,
      speed_dmps: null,
      bearing_deg: null,
      altitude_m: null,
    });
  });

  it('points: 500 is the most the contract takes in one batch', () => {
    const many = Array.from({ length: 501 }, (_, i) => point(i + 1));
    expect(
      accepts(encode({ type: 'telemetry.batch', clientId: A, points: many.slice(0, 500) })),
    ).toBe(true);
    expect(accepts(encode({ type: 'telemetry.batch', clientId: A, points: many }))).not.toBe(true);
  });
});

describe('halvedBatch', () => {
  const e = (status: number, code = 'x') => new ApiError(status, code, false);
  it.each([
    [413, 500, 250],
    [422, 500, 250],
    [413, 3, 1],
    [422, 2, 1],
    [413, 1, null],
    [422, 1, null],
    [400, 500, null],
    [409, 500, null],
    [503, 500, null],
  ])('%i after %i points: %p', (status, sent, next) => {
    expect(halvedBatch(e(status), sent)).toBe(next);
  });
});
