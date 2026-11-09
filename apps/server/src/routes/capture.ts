import type { ModuleJob } from '@milewage/shared';
import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import { createShiftRepository, type Db } from '../db';
import {
  anonymizer,
  CAPTURE_CAP_BYTES,
  createCaptureStore,
  FIX_BYTES,
  stateOf,
  type CaptureStore,
  type SessionRow,
} from '../diagnostics/capture';
import type { DiagnosticsStore } from '../diagnostics/store';
import type { DiskState } from '../disk';
import { ProblemError } from '../errors';
import { idParams, strictObject } from './util';

const ms = { type: 'integer', minimum: 0 };
const uuid = { type: 'string', format: 'uuid' };
const createBody = strictObject(
  {
    device_id: { type: 'integer', minimum: 1 },
    profile: { enum: ['dense'] },
    hours: { type: 'integer', minimum: 1, maximum: 168 },
    max_shifts: { type: 'integer', minimum: 1, maximum: 5 },
  },
  ['device_id'],
);
const patchBody = strictObject({ state: { const: 'ended' } }, ['state']);
const fixBody = strictObject(
  {
    shift: uuid,
    fixes: {
      type: 'array',
      minItems: 1,
      maxItems: 500,
      items: strictObject(
        {
          seq: { type: 'integer', minimum: 1 },
          recorded_at: ms,
          lat_e7: { type: 'integer', minimum: -900000000, maximum: 900000000 },
          lon_e7: { type: 'integer', minimum: -1800000000, maximum: 1800000000 },
          accuracy_m: ms,
          speed_dmps: { type: ['integer', 'null'] },
          bearing_deg: { type: ['integer', 'null'] },
          altitude_m: { type: ['integer', 'null'] },
        },
        ['seq', 'recorded_at', 'lat_e7', 'lon_e7', 'accuracy_m'],
      ),
    },
  },
  ['shift', 'fixes'],
);
const annotationBody = strictObject(
  {
    at: ms,
    kind: { enum: ['real_stop', 'false_stop', 'missed_stop', 'event', 'note'] },
    shift: uuid,
    stop_key: { type: 'string', maxLength: 120 },
    text: { type: 'string', maxLength: 500 },
  },
  ['at', 'kind'],
);
const annotationParams = strictObject({ id: { type: 'integer', minimum: 1 }, client_id: uuid }, [
  'id',
  'client_id',
]);
const replayQuery = strictObject({ mode: { enum: ['anonymized', 'exact'] } }, []);

export interface CaptureRouteDeps {
  db: Db;
  now: () => number;
  authn: Authenticator;
  store: () => DiagnosticsStore;
  disk?: () => DiskState;
  /** Called with a lifecycle fact for the diagnostics log (`capture.state`). */
  announce: (
    event: 'created' | 'ended' | 'expired' | 'purged',
    session: SessionRow,
    shiftsDone: number,
  ) => void;
  /** How often the 30 day purge runs (a day unless a test shortens it). */
  purgeEveryMs?: number;
}

/** Capture sessions (module `capture`, default off; 16 section 8). */
export function captureModuleParts({
  db,
  now,
  authn,
  store,
  disk,
  announce,
  purgeEveryMs,
}: CaptureRouteDeps) {
  const cs = (): CaptureStore => createCaptureStore(store().db);
  const shifts = createShiftRepository(db);

  const view = (c: CaptureStore, s: SessionRow) => {
    const fixes = c.fixCount(s.id);
    return {
      id: s.id,
      device_id: s.deviceId,
      profile: s.profile,
      created_at: s.createdAt,
      expires_at: s.expiresAt,
      ended_at: s.endedAt,
      max_shifts: s.maxShifts,
      shifts_done: c.shiftsDone(s.id),
      fix_count: fixes,
      bytes: fixes * FIX_BYTES,
      state: stateOf(s, now()),
    };
  };
  const own = (c: CaptureStore, userId: number, id: number) => {
    const s = c.session(id);
    if (!s || s.userId !== userId) throw new ProblemError('not_found', 'No such capture session.');
    return s;
  };
  const invalid = (path: string, message: string) =>
    new ProblemError('validation_failed', 'The request is not valid.', [{ path, message }]);

  const routes = ({ app }: ServerRouteHost) => {
    app.post(
      '/diagnostics/capture-sessions',
      { schema: { body: createBody } },
      async (req, reply) => {
        const p = authn.authenticate(req, 'S');
        const b = req.body as { device_id: number; hours?: number; max_shifts?: number };
        const device = db
          .prepare('SELECT 1 FROM devices WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
          .get(b.device_id, p.userId);
        if (!device) throw invalid('/device_id', 'no such paired device');
        const c = cs();
        if (disk && disk() !== 'ok') {
          throw new ProblemError(
            'insufficient_storage',
            'Disk space is low: no new capture session.',
          );
        }
        if (c.totalBytes() >= CAPTURE_CAP_BYTES) {
          throw new ProblemError(
            'insufficient_storage',
            'Capture data is at its 200 MB cap: delete a session first.',
          );
        }
        if (c.activeFor(b.device_id, now()).length > 0) {
          throw new ProblemError(
            'capture_active',
            'This device already has an active capture session.',
          );
        }
        const id = c.insert({
          userId: p.userId,
          deviceId: b.device_id,
          profile: 'dense',
          createdAt: now(),
          expiresAt: now() + (b.hours ?? 48) * 3600_000,
          maxShifts: b.max_shifts ?? 3,
        });
        const s = c.session(id)!;
        announce('created', s, 0);
        return reply.status(201).send(view(c, s));
      },
    );

    app.get('/diagnostics/capture-sessions', async (req) => {
      const p = authn.authenticate(req, 'S');
      const c = cs();
      return c.sessions(p.userId).map((s) => view(c, s));
    });

    app.patch(
      '/diagnostics/capture-sessions/:id',
      { schema: { params: idParams, body: patchBody } },
      async (req) => {
        const p = authn.authenticate(req, 'S');
        const c = cs();
        const s = own(c, p.userId, (req.params as { id: number }).id);
        if (s.endedAt === null) {
          c.end(s.id, now());
          announce('ended', s, c.shiftsDone(s.id));
        }
        return view(c, c.session(s.id)!);
      },
    );

    app.delete(
      '/diagnostics/capture-sessions/:id',
      { schema: { params: idParams } },
      async (req, reply) => {
        const p = authn.authenticate(req, 'S');
        const c = cs();
        const s = own(c, p.userId, (req.params as { id: number }).id);
        announce('purged', s, c.shiftsDone(s.id));
        c.remove(s.id);
        return reply.status(204).send();
      },
    );

    app.post(
      '/diagnostics/capture-sessions/:id/fixes',
      {
        bodyLimit: 1024 * 1024,
        config: { maxEncoded: 256 * 1024, rateLimit: 'telemetry' },
        schema: { params: idParams, body: fixBody },
      },
      async (req) => {
        const d = authn.authenticate(req, 'D');
        const c = cs();
        const s = c.session((req.params as { id: number }).id);
        if (!s || s.deviceId !== d.deviceId)
          throw new ProblemError('not_found', 'No such capture session.');
        if (stateOf(s, now()) !== 'active') {
          throw new ProblemError(
            'capture_active',
            'This capture session has ended; stop recording.',
          );
        }
        const b = req.body as {
          shift: string;
          fixes: {
            seq: number;
            recorded_at: number;
            lat_e7: number;
            lon_e7: number;
            accuracy_m: number;
            speed_dmps?: number | null;
            bearing_deg?: number | null;
            altitude_m?: number | null;
          }[];
        };
        const shift = shifts.byClientId(d.userId, b.shift.toLowerCase());
        if (!shift) throw new ProblemError('shift_not_found', 'No such shift.');
        if (!c.hasShift(s.id, shift.clientId) && c.shiftsDone(s.id) >= s.maxShifts) {
          throw new ProblemError(
            'capture_active',
            'This session already holds its maximum number of shifts.',
          );
        }
        if (c.totalBytes() >= CAPTURE_CAP_BYTES) {
          throw new ProblemError('insufficient_storage', 'Capture data is at its 200 MB cap.');
        }
        const inserted = c.insertFixes(
          s.id,
          shift.clientId,
          b.fixes.map((f) => ({
            seq: f.seq,
            t: f.recorded_at,
            latE7: f.lat_e7,
            lonE7: f.lon_e7,
            accuracyM: f.accuracy_m,
            speedDmps: f.speed_dmps ?? null,
            bearingDeg: f.bearing_deg ?? null,
            altitudeM: f.altitude_m ?? null,
          })),
        );
        // So a difference between a captured and an ordinary shift can be attributed (16 section 8.2).
        db.prepare(
          `INSERT INTO shift_flags (user_id, shift_id, code, severity, detail, created_at)
           SELECT ?, ?, 'capture_session', 'info', NULL, ?
            WHERE NOT EXISTS (SELECT 1 FROM shift_flags WHERE shift_id = ? AND code = 'capture_session')`,
        ).run(d.userId, shift.id, now(), shift.id);
        return { accepted: inserted, duplicates: b.fixes.length - inserted };
      },
    );

    const annotationView = (a: ReturnType<CaptureStore['annotations']>[number]) => ({
      client_id: a.clientId,
      at: a.at,
      kind: a.kind,
      shift: a.shift,
      stop_key: a.stopKey,
      text: a.text,
    });
    app.put(
      '/diagnostics/capture-sessions/:id/annotations/:client_id',
      { schema: { params: annotationParams, body: annotationBody } },
      async (req) => {
        const p = authn.authenticate(req, 'S');
        const c = cs();
        const params = req.params as { id: number; client_id: string };
        const s = own(c, p.userId, params.id);
        const b = req.body as {
          at: number;
          kind: 'real_stop';
          shift?: string;
          stop_key?: string;
          text?: string;
        };
        const a = {
          clientId: params.client_id.toLowerCase(),
          at: b.at,
          kind: b.kind,
          shift: b.shift?.toLowerCase() ?? null,
          stopKey: b.stop_key ?? null,
          text: b.text ?? null,
        };
        c.putAnnotation(s.id, a);
        return annotationView(a);
      },
    );
    app.delete(
      '/diagnostics/capture-sessions/:id/annotations/:client_id',
      { schema: { params: annotationParams } },
      async (req, reply) => {
        const p = authn.authenticate(req, 'S');
        const c = cs();
        const params = req.params as { id: number; client_id: string };
        const s = own(c, p.userId, params.id);
        if (!c.deleteAnnotation(s.id, params.client_id.toLowerCase()))
          throw new ProblemError('not_found', 'No such annotation.');
        return reply.status(204).send();
      },
    );

    app.get(
      '/diagnostics/capture-sessions/:id/replay',
      { schema: { params: idParams, querystring: replayQuery } },
      async (req, reply) => {
        const p = authn.authenticate(req, 'S');
        const c = cs();
        const s = own(c, p.userId, (req.params as { id: number }).id);
        const exact = (req.query as { mode?: string }).mode === 'exact';
        const fixes = c.fixes(s.id);
        const first = fixes[0];
        const t0 = first?.t ?? 0;
        const names = new Map<string, string>();
        const shiftName = (id: string | null) => {
          if (id === null) return null;
          if (exact) return id;
          if (!names.has(id)) names.set(id, `S${names.size + 1}`);
          return names.get(id)!;
        };
        const at = (t: number) => (exact ? t : t - t0);
        const place = first && !exact ? anonymizer(first) : undefined;
        const lines: object[] = [];
        for (const f of fixes) shiftName(f.shift);
        const pt = (f: { latE7: number; lonE7: number }) => (place ? place(f) : f);
        lines.push({
          t: 'meta',
          mode: exact ? 'exact' : 'anonymized',
          profile: s.profile,
          fixes: fixes.length,
          shifts: [...new Set(fixes.map((f) => f.shift))].length,
          ...(exact ? { capture_id: s.id, device_id: s.deviceId } : {}),
        });
        for (const f of fixes) {
          const q = pt(f);
          lines.push({
            t: 'fix',
            seq: f.seq,
            shift: shiftName(f.shift),
            at: at(f.t),
            lat_e7: q.latE7,
            lon_e7: q.lonE7,
            accuracy_m: f.accuracyM,
            speed_dmps: f.speedDmps,
            bearing_deg: f.bearingDeg,
            altitude_m: exact ? f.altitudeM : null,
          });
        }
        for (const a of c.annotations(s.id)) {
          lines.push({
            t: 'annotation',
            client_id: a.clientId,
            at: at(a.at),
            kind: a.kind,
            shift: shiftName(a.shift),
            stop_key:
              exact || !a.stopKey
                ? a.stopKey
                : a.stopKey.replace(
                    /^[^:]*:(\d+):stop$/,
                    (_m, e: string) =>
                      `${shiftName(a.shift) ?? 'S?'}:${Math.round(Number(e) - t0)}:stop`,
                  ),
            ...(exact ? { text: a.text } : {}),
          });
        }
        for (const clientId of new Set(fixes.map((f) => f.shift))) {
          const sh = shifts.byClientId(p.userId, clientId);
          if (!sh) continue;
          lines.push({
            t: 'shift',
            shift: shiftName(clientId),
            started_at: at(sh.startedAt),
            duration_s: sh.endedAt === null ? null : Math.round((sh.endedAt - sh.startedAt) / 1000),
            total_m: sh.totalM,
            active_m: sh.activeM,
            deadhead_m: sh.deadheadM,
            segmenter: sh.segmenter,
            calc_version: sh.calcVersion,
          });
        }
        return reply
          .header('Content-Type', 'application/x-ndjson')
          .send(lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
      },
    );
  };

  const job: ModuleJob = {
    name: 'capture-purge',
    start() {
      const timer = setInterval(
        () => {
          try {
            const c = cs();
            const t = now();
            c.purge(t);
          } catch {
            // housekeeping must never take the server down
          }
        },
        purgeEveryMs ?? 24 * 3600_000,
      );
      timer.unref();
      return () => clearInterval(timer);
    },
  };
  return { routes, job, view: (s: SessionRow) => view(cs(), s) };
}
