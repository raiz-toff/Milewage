import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import {
  createProcessingRepository,
  type Db,
  type ShiftRow,
  type StopLabelRow,
  type StopRow,
} from '../db';
import { ProblemError } from '../errors';
import type { DriverContexts } from '../driver-context';
import type { ShiftBook } from '../processing/shift-book';
import type { ShiftPresenter } from '../processing/presenter';
import { refParam, snakeKeys, str, strictObject, type Principal } from './util';

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
export const stopView = (s: StopRow, label: StopLabelRow | undefined) => ({
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
  drivers,
  present,
  book,
  platformOk,
}: {
  db: Db;
  now: () => number;
  authn: Authenticator;
  drivers: DriverContexts;
  present: ShiftPresenter;
  /** Labels change the split only through an engine run, recorded and announced by the book. */
  book: ShiftBook;
  /** With the platforms module on: whether a slug is a built-in or the driver's own (18 section 4.2). */
  platformOk?: (userId: number, slug: string) => boolean;
}) {
  return ({ app, bus }: ServerRouteHost) => {
    const repo = createProcessingRepository(db);

    /** The shift and its owner's settings guard. */
    const open = (req: Parameters<typeof authn.authenticate>[0]) => {
      const p = authn.authenticate(req, 'S');
      if (!drivers.of(p.userId).stopsOn) {
        throw new ProblemError('not_found', 'Stops are turned off.');
      }
      return { p, shift: book.find(p, (req.params as { ref: string }).ref) };
    };
    const keyOf = (req: { params: unknown }) => (req.params as { stop_key: string }).stop_key;
    const withLabel = (shift: ShiftRow, key: string) => {
      const stop = repo.stopsOf(shift.id).find((s) => s.stopKey === key);
      return stop && stopView(stop, repo.findLabel(shift.id, key));
    };

    app.get('/shifts/:ref/stops', { schema: { params: shiftParams } }, async (req) => {
      const { shift } = open(req);
      const labels = new Map(repo.labelsOf(shift.id).map((l) => [l.stopKey, l]));
      return repo.stopsOf(shift.id).map((s) => stopView(s, labels.get(s.stopKey)));
    });

    /** Labels change only an ended, not finalized, shift: the engine reads them when it runs. */
    const editable = (shift: ShiftRow) => {
      if (shift.status === 'finalized')
        throw new ProblemError('shift_finalized', 'This shift is finalized.');
      if (shift.status === 'active')
        throw new ProblemError('shift_not_ended', 'Label stops after the shift has ended.');
      book.needsEngine(shift);
    };
    const recompute = (p: Principal, shift: ShiftRow) =>
      present.one(book.recompute(p, shift, { cause: 'label' }));

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
        if (b.platform && platformOk && !platformOk(p.userId, b.platform)) {
          throw new ProblemError('validation_failed', 'The request is not valid.', [
            { path: '/platform', message: 'is not one of your platforms' },
          ]);
        }
        const old = repo.findLabel(shift.id, key);
        // Last writer wins on the edit time; ties go to the server (08 section 4.4).
        if (old && b.edited_at <= old.editedAt) {
          return reply.header('X-MileWage-Applied', 'false').send({
            stop: withLabel(shift, key),
            shift: present.one(shift),
          });
        }
        if (old) {
          bus.emit('edit.overwritten', {
            userId: String(p.userId),
            entity: 'stop_label',
            key: `${shift.clientId}/${key}`,
            superseded: labelView(old),
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
        const updated = recompute(p, shift);
        return reply
          .header('X-MileWage-Applied', 'true')
          .send({ stop: withLabel(shift, key), shift: updated });
      },
    );

    app.delete('/shifts/:ref/stop-labels/:stop_key', { schema: { params } }, async (req) => {
      const { p, shift } = open(req);
      editable(shift);
      const key = keyOf(req);
      const stopExists = repo.stopsOf(shift.id).some((s) => s.stopKey === key);
      if (!stopExists && !repo.findLabel(shift.id, key)) {
        throw new ProblemError('not_found', 'This shift has no stop or label with that key.');
      }
      repo.deleteLabel(shift.id, key);
      const updated = recompute(p, shift);
      // `stop` is null only when an orphaned label (its stop is gone) was cleared.
      return { stop: withLabel(shift, key) ?? null, shift: updated };
    });
  };
}
