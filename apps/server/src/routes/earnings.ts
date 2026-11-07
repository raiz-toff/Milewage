import type { ModuleRegistry, RouteHost } from '@milewage/shared';
import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import {
  createEarningsRepository,
  createSettingsRepository,
  ENTRY_TYPES,
  totalOf,
  type Db,
  type EarningEntry,
  type EarningsRow,
  type EffectiveOptions,
  type EntryType,
} from '../db';
import { ProblemError } from '../errors';
import { platformKnown } from './platforms';
import { refParam, shiftReader } from './shift-access';
import { strictObject } from './util';

/** What counts as earnings right now: labels (stops on), typed rows (earnings on), and the override rule. */
export interface EarningsPolicy {
  options(userId: number, platform?: string): EffectiveOptions;
  /** True when anything can produce a figure; false means earnings are `null`, not zero. */
  any(userId: number): boolean;
}

export function createEarningsPolicy(
  db: Db,
  registry: ModuleRegistry,
  override: 'replace' | 'sum' = 'replace',
): EarningsPolicy {
  const settings = createSettingsRepository(db);
  const options = (userId: number, platform?: string): EffectiveOptions => ({
    labels: registry.isEnabled('stops') && settings.get(userId)?.stopsEnabled === 1,
    entries: registry.isEnabled('earnings'),
    override,
    ...(platform === undefined ? {} : { platform }),
  });
  return {
    options,
    any: (userId) => {
      const o = options(userId);
      return o.labels || o.entries;
    },
  };
}

const params = strictObject(
  { ref: refParam, platform: { type: 'string', pattern: '^[a-z0-9_]{1,32}$' } },
  ['ref', 'platform'],
);
const shiftParams = strictObject({ ref: refParam }, ['ref']);
const cents = { type: 'integer', minimum: 0, maximum: 1_000_000_000 };
const entryParams = strictObject({ ...params.properties, id: { type: 'integer', minimum: 1 } }, [
  'ref',
  'platform',
  'id',
]);
const entryBody = strictObject(
  {
    type: { enum: ENTRY_TYPES },
    amount_cents: { type: 'integer', minimum: -1_000_000_000, maximum: 1_000_000_000 },
    note: { type: ['string', 'null'], maxLength: 2000 },
  },
  ['type', 'amount_cents'],
);
/** Money the platform takes off is below zero; pay and top-ups are above (22 section 3.2). */
const PLUS: readonly EntryType[] = ['fare', 'tip', 'bonus', 'top_up'];
const signProblem = (type: EntryType, amount: number): string | null =>
  amount === 0
    ? 'must not be 0'
    : type === 'adjustment' || PLUS.includes(type) === amount > 0
      ? null
      : `a ${type.replace('_', ' ')} ${PLUS.includes(type) ? 'adds money, so it must be above 0' : 'takes money off, so it must be below 0'}`;

const putBody = strictObject(
  {
    gross_cents: cents,
    tips_cents: cents,
    bonus_cents: cents,
    orders: { type: ['integer', 'null'], minimum: 0, maximum: 10_000 },
    online_min: { type: ['integer', 'null'], minimum: 0, maximum: 1440 },
    notes: { type: ['string', 'null'], maxLength: 2000 },
  },
  [],
);

export const earningsView = (e: EarningsRow, ledger: EarningEntry[]) => ({
  platform: e.platform,
  gross_cents: e.grossCents,
  tips_cents: e.tipsCents,
  bonus_cents: e.bonusCents,
  fees_cents: e.feesCents,
  adjustments_cents: e.adjustmentsCents,
  total_cents: e.grossCents + e.tipsCents + e.bonusCents + e.feesCents + e.adjustmentsCents,
  tax_withheld_cents: e.taxWithheldCents,
  cash_collected_cents: e.cashCollectedCents,
  balance_cents: e.balanceCents,
  orders: e.orders,
  online_min: e.onlineMin,
  notes: e.notes,
  source: e.source,
  edited_at: e.editedAt,
  ledger: ledger.map((x) => ({
    id: x.id,
    type: x.type,
    amount_cents: x.amountCents,
    note: x.note,
    created_at: x.createdAt,
  })),
});

/** Module `earnings` (18 section 4.3): the driver's typed total per shift and platform. Web session only. */
export function earningsRoutes({
  db,
  now,
  authn,
  policy,
}: {
  db: Db;
  now: () => number;
  authn: Authenticator;
  policy: (registry: ModuleRegistry) => EarningsPolicy;
}) {
  return (host: RouteHost) => {
    const { app, registry, bus } = host as ServerRouteHost;
    const repo = createEarningsRepository(db);
    const read = shiftReader(db, now);
    /** The shift, when earnings may be written to it for this platform. */
    const writable = (me: Parameters<typeof read>[0], ref: string, platform: string) => {
      const shift = read(me, ref);
      if (shift.status === 'active') {
        throw new ProblemError('shift_not_ended', 'Enter earnings after the shift has ended.');
      }
      if (registry.isEnabled('platforms') && !platformKnown(db, me.userId, platform)) {
        throw new ProblemError('validation_failed', 'The request is not valid.', [
          { path: '/platform', message: 'is not one of your platforms' },
        ]);
      }
      return shift;
    };

    const listing = (userId: number, shiftId: number, date: string) => {
      const eff = repo
        .effective(userId, date, date, policy(registry).options(userId))
        .filter((r) => r.shiftId === shiftId);
      return {
        entries: repo.ofShift(shiftId).map((e) => earningsView(e, repo.entriesOf(e.id))),
        labels: repo.labelBreakdown(shiftId).map((l) => ({
          platform: l.platform,
          payout_cents: l.payoutCents,
          tip_cents: l.tipCents,
          dropoffs: l.dropoffs,
        })),
        effective: eff.map((r) => ({
          platform: r.platform,
          gross_cents: r.grossCents,
          tips_cents: r.tipsCents,
          bonus_cents: r.bonusCents,
          fees_cents: r.feesCents,
          adjustments_cents: r.adjustmentsCents,
          tax_withheld_cents: r.taxWithheldCents,
          total_cents: totalOf(r),
          orders: r.orders,
          source: r.source,
        })),
      };
    };

    app.get('/shifts/:ref/earnings', { schema: { params: shiftParams } }, async (req) => {
      const me = authn.authenticate(req, 'S');
      const { userId } = me;
      const shift = read(me, (req.params as { ref: string }).ref);
      return listing(userId, shift.id, shift.localDate);
    });

    app.put(
      '/shifts/:ref/earnings/:platform',
      { schema: { params, body: putBody } },
      async (req) => {
        const me = authn.authenticate(req, 'S');
        const { userId } = me;
        const { ref, platform } = req.params as { ref: string; platform: string };
        const shift = writable(me, ref, platform);
        const b = req.body as Partial<{
          gross_cents: number;
          tips_cents: number;
          bonus_cents: number;
          orders: number | null;
          online_min: number | null;
          notes: string | null;
        }>;
        repo.put({
          userId,
          shiftId: shift.id,
          platform,
          grossCents: b.gross_cents ?? 0,
          tipsCents: b.tips_cents ?? 0,
          bonusCents: b.bonus_cents ?? 0,
          orders: b.orders ?? null,
          onlineMin: b.online_min ?? null,
          notes: b.notes ?? null,
          source: 'manual',
          editedAt: now(),
        });
        bus.emit('earnings.changed', { shiftId: String(shift.id) });
        return listing(userId, shift.id, shift.localDate);
      },
    );

    // 22 section 5.2: one entry at a time; no edit, delete and add again.
    app.post(
      '/shifts/:ref/earnings/:platform/entries',
      { schema: { params, body: entryBody } },
      async (req) => {
        const me = authn.authenticate(req, 'S');
        const { ref, platform } = req.params as { ref: string; platform: string };
        const shift = writable(me, ref, platform);
        const b = req.body as { type: EntryType; amount_cents: number; note?: string | null };
        const problem = signProblem(b.type, b.amount_cents);
        if (problem) {
          throw new ProblemError('validation_failed', 'The request is not valid.', [
            { path: '/amount_cents', message: problem },
          ]);
        }
        const row = { userId: me.userId, shiftId: shift.id, platform, editedAt: now() };
        repo.addEntry(row, { type: b.type, amountCents: b.amount_cents, note: b.note ?? null });
        bus.emit('earnings.changed', { shiftId: String(shift.id) });
        return listing(me.userId, shift.id, shift.localDate);
      },
    );

    app.delete(
      '/shifts/:ref/earnings/:platform/entries/:id',
      { schema: { params: entryParams } },
      async (req) => {
        const me = authn.authenticate(req, 'S');
        const { ref, platform, id } = req.params as { ref: string; platform: string; id: number };
        const shift = read(me, ref);
        const row = repo.find(shift.id, platform);
        if (row && repo.deleteEntry(row.id, id)) {
          bus.emit('earnings.changed', { shiftId: String(shift.id) });
        }
        return listing(me.userId, shift.id, shift.localDate);
      },
    );

    app.delete('/shifts/:ref/earnings/:platform', { schema: { params } }, async (req) => {
      const me = authn.authenticate(req, 'S');
      const { userId } = me;
      const { ref, platform } = req.params as { ref: string; platform: string };
      const shift = read(me, ref);
      repo.delete(shift.id, platform);
      bus.emit('earnings.changed', { shiftId: String(shift.id) });
      return listing(userId, shift.id, shift.localDate);
    });
  };
}
