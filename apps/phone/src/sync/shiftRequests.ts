import { gzipSync, strToU8 } from 'fflate';
import type { paths } from '@milewage/shared/generated/api-types';
import type { ApiClient, ApiError, ApiResponse } from '../api/client';
import type { TripRow } from '../store/shiftStore';
import type { TrackerPoint } from '../tracker/types';

/**
 * What the phone tells the server about a shift, encoded once (08 sections 4 and 5, 15 section
 * 6.2). Every place that sends a shift change, straight away or through the outbox, builds its
 * request here from the phone's own records; the bodies are typed by the contract
 * (`packages/shared/openapi/openapi.yaml`, through the generated `paths`), so a field the spec
 * changes is a compile error here and nowhere else.
 */

/** The JSON request body of one operation in the contract. */
type JsonBody<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  requestBody: { content: { 'application/json': infer B } };
}
  ? B
  : never;

/** Every body the phone sends about a shift, by change type. */
export interface Bodies {
  'shift.create': JsonBody<'/shifts', 'post'>;
  'shift.patch': JsonBody<'/shifts/{ref}', 'patch'>;
  'odometer.put': JsonBody<'/shifts/{ref}/odometer/{kind}', 'put'>;
  'trip.override': JsonBody<'/shifts/{ref}/trip-overrides/{trip_key}', 'put'>;
  'trip.manual': JsonBody<'/shifts/{ref}/trips/{client_id}', 'put'>;
  'shift.end': JsonBody<'/shifts/{ref}/end', 'post'>;
  'telemetry.batch': JsonBody<'/telemetry/batch', 'post'>;
}

export type ChangeType = keyof Bodies;
/** The changes that wait in the outbox; points go through the upload worker instead. */
export type OutboxKind = Exclude<ChangeType, 'telemetry.batch'>;

type Segmenter = 'stops' | 'whole_shift';
type TripKind = 'active' | 'deadhead' | 'personal';

/** Which points of the shift the phone holds (15 section 6.1). */
export interface Manifest {
  firstSeq: number;
  lastSeq: number;
  pointCount: number;
}

/** The phone's own engine result for a shift, sent with its end (14 section 9.3). */
export interface PhoneTotals {
  calcVersion: number;
  segmenter: Segmenter;
  inputDigest: string;
  totalM: number;
  activeM: number;
  deadheadM: number;
  personalM: number;
  /** Automatic trips only. */
  tripsCount: number;
}

/** One change to a shift, in the phone's own terms. */
export type ShiftChange =
  | {
      type: 'shift.create';
      clientId: string;
      vehicleId: number;
      startedAt: number;
      segmenter: Segmenter;
      /** Sent only when there are some (a shift created again after a restore keeps its notes). */
      notes?: string | null;
    }
  | { type: 'shift.patch'; clientId: string; notes: string; updatedAt: number }
  | {
      type: 'odometer.put';
      clientId: string;
      reading: 'shift_start' | 'shift_end';
      /** Metres; rounded to whole metres here. */
      readingM: number;
      recordedAt: number;
    }
  /** An automatic trip's kind or purpose. `tripKey` starts with the shift's client id. */
  | { type: 'trip.override'; tripKey: string; kind: TripKind; purpose: string; editedAt: number }
  | {
      type: 'trip.manual';
      clientId: string;
      tripKey: string;
      kind: TripKind;
      startedAt: number;
      endedAt: number;
      distanceM: number;
      purpose: string;
      editedAt: number;
    }
  | {
      type: 'shift.end';
      clientId: string;
      endedAt: number;
      /** Null when the phone has nothing to report: then only `ended_at` is sent. */
      manifest: Manifest | null;
      phoneResult: PhoneTotals | null;
    }
  | { type: 'telemetry.batch'; clientId: string; points: readonly TrackerPoint[] };

export type QueuedChange = Exclude<ShiftChange, { type: 'telemetry.batch' }>;

/** A manual trip as the phone keeps it (its `trips` row), edited at `editedAt`. */
export const manualTripOf = (
  clientId: string,
  t: Pick<TripRow, 'trip_key' | 'kind' | 'started_at' | 'ended_at' | 'distance_m' | 'purpose'>,
  editedAt: number,
): QueuedChange => ({
  type: 'trip.manual',
  clientId,
  tripKey: t.trip_key,
  kind: t.kind,
  startedAt: t.started_at,
  endedAt: t.ended_at,
  distanceM: t.distance_m,
  purpose: t.purpose,
  editedAt,
});

/** One request, ready to send or to keep in the outbox (`kind`, `entityKey` and `body` are stored). */
export type ShiftRequest = {
  [K in ChangeType]: {
    kind: K;
    /** The shift's client id, then what the change is about; see `route`. */
    entityKey: string;
    method: 'POST' | 'PUT' | 'PATCH';
    path: string;
    body: Bodies[K];
  } & (K extends 'telemetry.batch' ? { gzip: Uint8Array } : unknown);
}[ChangeType];

export type QueuedRequest = Exclude<ShiftRequest, { kind: 'telemetry.batch' }>;

/** The shift a request is about: every entity key starts with the shift's client id (a UUID). */
export const shiftOf = (entityKey: string): string => entityKey.split(':')[0]!;

/**
 * Entity keys: shift `client_id`; `<shift>:<odometer kind>`; `<shift>:<segment ms>:<kind>` (an
 * automatic trip's key); `<shift>:<trip uuid>` (a manual trip).
 */
function route(kind: ChangeType, entityKey: string): Pick<ShiftRequest, 'method' | 'path'> {
  const shift = shiftOf(entityKey);
  const rest = entityKey.slice(shift.length + 1);
  switch (kind) {
    case 'shift.create':
      return { method: 'POST', path: '/shifts' };
    case 'shift.patch':
      return { method: 'PATCH', path: `/shifts/${shift}` };
    case 'odometer.put':
      return { method: 'PUT', path: `/shifts/${shift}/odometer/${rest}` };
    case 'trip.override':
      return {
        method: 'PUT',
        path: `/shifts/${shift}/trip-overrides/${encodeURIComponent(entityKey)}`,
      };
    case 'trip.manual':
      return { method: 'PUT', path: `/shifts/${shift}/trips/${rest}` };
    case 'shift.end':
      return { method: 'POST', path: `/shifts/${shift}/end` };
    case 'telemetry.batch':
      return { method: 'POST', path: '/telemetry/batch' };
  }
}

const request = <K extends ChangeType>(kind: K, entityKey: string, body: Bodies[K]) =>
  ({ kind, entityKey, ...route(kind, entityKey), body }) as Extract<ShiftRequest, { kind: K }>;

/** The request for one change. Bodies hold exactly the contract's fields, nothing of the phone's own. */
export function encode<C extends ShiftChange>(c: C): Extract<ShiftRequest, { kind: C['type'] }>;
export function encode(c: ShiftChange): ShiftRequest {
  switch (c.type) {
    case 'shift.create':
      return request(c.type, c.clientId, {
        client_id: c.clientId,
        vehicle_id: c.vehicleId,
        started_at: c.startedAt,
        segmenter: c.segmenter,
        ...(c.notes != null ? { notes: c.notes } : {}),
      });
    case 'shift.patch':
      return request(c.type, c.clientId, { notes: c.notes, updated_at: c.updatedAt });
    case 'odometer.put':
      return request(c.type, `${c.clientId}:${c.reading}`, {
        reading_m: Math.round(c.readingM),
        recorded_at: c.recordedAt,
      });
    case 'trip.override':
      return request(c.type, c.tripKey, {
        kind: c.kind,
        purpose: c.purpose,
        edited_at: c.editedAt,
      });
    case 'trip.manual':
      return request(c.type, `${c.clientId}:${c.tripKey}`, {
        kind: c.kind,
        started_at: c.startedAt,
        ended_at: c.endedAt,
        distance_m: c.distanceM,
        purpose: c.purpose,
        edited_at: c.editedAt,
      });
    case 'shift.end': {
      const m = c.manifest;
      const r = c.phoneResult;
      return request(c.type, c.clientId, {
        ended_at: c.endedAt,
        ...(m
          ? { manifest: { first_seq: m.firstSeq, last_seq: m.lastSeq, point_count: m.pointCount } }
          : {}),
        ...(r
          ? {
              phone_result: {
                calc_version: r.calcVersion,
                segmenter: r.segmenter,
                input_digest: r.inputDigest,
                total_m: r.totalM,
                active_m: r.activeM,
                deadhead_m: r.deadheadM,
                personal_m: r.personalM,
                trips_count: r.tripsCount,
              },
            }
          : {}),
      });
    }
    case 'telemetry.batch': {
      const body: Bodies['telemetry.batch'] = {
        shift_client_id: c.clientId,
        points: c.points.map((p) => ({
          seq: p.seq,
          recorded_at: p.recordedAt,
          lat_e7: p.latE7,
          lon_e7: p.lonE7,
          accuracy_m: p.accuracyM,
          speed_dmps: p.speedDmps,
          bearing_deg: p.bearingDeg,
          altitude_m: p.altitudeM,
        })),
      };
      // Sent gzipped (08 section 5): a batch is up to 500 points.
      return {
        ...request(c.type, c.clientId, body),
        gzip: gzipSync(strToU8(JSON.stringify(body))),
      };
    }
  }
}

/** The request for an outbox row: its path comes from its kind and entity key, as when queued. */
export function requestFor(item: {
  kind: OutboxKind;
  entityKey: string;
  body: unknown;
}): QueuedRequest {
  return {
    kind: item.kind,
    entityKey: item.entityKey,
    ...route(item.kind, item.entityKey),
    body: item.body,
  } as QueuedRequest;
}

/** Sends one request; a point batch goes gzipped. Errors are the client's `ApiError`s. */
export function send<T = unknown>(client: ApiClient, req: ShiftRequest): Promise<ApiResponse<T>> {
  return req.kind === 'telemetry.batch'
    ? client.request<T>(req.method, req.path, undefined, { 'Content-Encoding': 'gzip' }, req.gzip)
    : client.request<T>(req.method, req.path, req.body);
}

/**
 * The batch size to try after the server refused a point batch of `sent` points as too large
 * (413) or as holding a point it cannot take (422): half of it, so the bad point is found or the
 * batch fits. Null when halving cannot help (one point, or another refusal).
 */
export function halvedBatch(e: ApiError, sent: number): number | null {
  if ((e.status === 413 || e.status === 422) && sent > 1) return Math.max(1, Math.floor(sent / 2));
  return null;
}
