import type { RouteHost } from '@milewage/shared';
import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import {
  createProcessingRepository,
  createSettingsRepository,
  type Db,
  type StopLabelRow,
  type StopRow,
} from '../db';
import { ProblemError } from '../errors';
import type { ShiftProcessor } from '../processing/shift-processor';
import { refParam, shiftReader } from './shift-access';
import { shiftView } from './shifts';
import { snakeKeys, str, strictObject } from './util';

const params = strictObject({ ref: refParam, stop_key: str(1, 200) }, ['ref', 'stop_key']);
const shiftParams = strictObject({ ref: refParam }, ['ref']);
const cents = { type: 'integer', minimum: 0 };
const labelBody = strictObject(
  {
    role: { enum: ['pickup', 'dropoff', 'other'] },
    platform: { type: ['string', 'null'], pattern: '^[a-z0-9_]{1,32}$' },
    place: { type: ['string', 'null'], maxLength: 120 },
    payout_cents: cents,
    tip_cents: cents,
    notes: { type: ['string', 'null'], maxLength: 2000 },
    edited_at: { type: 'integer', minimum: 0 },
  },
  ['role', 'edited_at'],
);

const labelView = (l: StopLabelRow) => snakeKeys(l, 'userId');
const stopView = (s: StopRow, label: StopLabelRow | undefined) => ({
  ...snakeKeys(s, 'id', 'userId'),
  label: label ? labelView(label) : null,
});

/**
 * Stops and the driver's optional labels (08 sections 3 and 4.4, 14 section 6.6). Web session only.
 * Every route answers 404 while the `stops_enabled` setting is off, whatever is stored (07 section 2.8).
 */
export function stopsRoutes({
  db,
  now,
  authn,
  processor,
}: {
  db: Db;
  now: () => number;
  authn: Authenticator;
  processor: ShiftProcessor;
}) {
  return (host: RouteHost) => {
    const { app } = host as ServerRouteHost;
    const repo = createProcessingRepository(db);
    const settings = createSettingsRepository(db);
    const read = shiftReader(db, now);

    /** The shift and its owner's settings guard. */
    const open = (req: Parameters<typeof authn.authenticate>[0]) => {
      const p = authn.authenticate(req, 'S');
      if (settings.get(p.userId)?.stopsEnabled !== 1) {
        throw new ProblemError('not_found', 'Stops are turned off.');
      }
      return { p, shift: read(p, (req.params as { ref: string }).ref) };
    };
    const keyOf = (req: { params: unknown }) => (req.params as { stop_key: string }).stop_key;
    const withLabel = (shiftId: number, key: string) => {
      const stop = repo.stopsOf(shiftId).find((s) => s.stopKey === key);
      return stop && stopView(stop, repo.findLabel(shiftId, key));
    };

    app.get('/shifts/:ref/stops', { schema: { params: shiftParams } }, async (req) => {
      const { shift } = open(req);
      const labels = new Map(repo.labelsOf(shift.id).map((l) => [l.stopKey, l]));
      return repo.stopsOf(shift.id).map((s) => stopView(s, labels.get(s.stopKey)));
    });

    /** Labels change only an ended, not finalized, shift: the engine reads them when it runs. */
    const editable = (shift: ReturnType<typeof read>) => {
      if (shift.status === 'finalized')
        throw new ProblemError('shift_finalized', 'This shift is finalized.');
      if (shift.status === 'active')
        throw new ProblemError('shift_not_ended', 'Label stops after the shift has ended.');
    };
    const recompute = (shift: ReturnType<typeof read>) => {
      const flags = (id: number) => repo.flagsOf([id]).get(id);
      const saved = processor.run(shift).shift;
      return shiftView(saved, flags(saved.id));
    };

    app.put(
      '/shifts/:ref/stop-labels/:stop_key',
      { schema: { params, body: labelBody } },
      async (req, reply) => {
        const { p, shift } = open(req);
        editable(shift);
        const key = keyOf(req);
        const b = req.body as {
          role: StopLabelRow['role'];
          platform?: string | null;
          place?: string | null;
          payout_cents?: number;
          tip_cents?: number;
          notes?: string | null;
          edited_at: number;
        };
        if (b.edited_at > now() + 5 * 60 * 1000) {
          throw new ProblemError('validation_failed', 'The request is not valid.', [
            { path: '/edited_at', message: 'must not be more than 5 minutes in the future' },
          ]);
        }
        if (!repo.stopsOf(shift.id).some((s) => s.stopKey === key)) {
          throw new ProblemError('not_found', 'This shift has no stop with that key.');
        }
        const old = repo.findLabel(shift.id, key);
        // Last writer wins on the edit time; ties go to the server (08 section 4.4).
        if (old && b.edited_at <= old.editedAt) {
          return reply.header('X-MileWage-Applied', 'false').send({
            stop: withLabel(shift.id, key),
            shift: shiftView(shift, repo.flagsOf([shift.id]).get(shift.id)),
          });
        }
        repo.putLabel({
          userId: p.userId,
          shiftId: shift.id,
          stopKey: key,
          role: b.role,
          platform: b.platform ?? null,
          place: b.place ?? null,
          payoutCents: b.payout_cents ?? 0,
          tipCents: b.tip_cents ?? 0,
          notes: b.notes ?? null,
          editedAt: b.edited_at,
        });
        const updated = recompute(shift);
        return reply
          .header('X-MileWage-Applied', 'true')
          .send({ stop: withLabel(shift.id, key), shift: updated });
      },
    );

    app.delete('/shifts/:ref/stop-labels/:stop_key', { schema: { params } }, async (req) => {
      const { shift } = open(req);
      editable(shift);
      const key = keyOf(req);
      const stopExists = repo.stopsOf(shift.id).some((s) => s.stopKey === key);
      if (!stopExists && !repo.findLabel(shift.id, key)) {
        throw new ProblemError('not_found', 'This shift has no stop or label with that key.');
      }
      repo.deleteLabel(shift.id, key);
      const updated = recompute(shift);
      // `stop` is null only when an orphaned label (its stop is gone) was cleared.
      return { stop: withLabel(shift.id, key) ?? null, shift: updated };
    });
  };
}
