import type { ServerRouteHost } from '../app';
import type { Authenticator } from '../auth/authenticator';
import {
  createEarningsRepository,
  createExpenseRepository,
  createProcessingRepository,
  createTaxRepository,
  type Db,
  type ShiftRow,
} from '../db';
import { ProblemError } from '../errors';
import { analytics, type AShift } from '../analytics';
import { deductibleCents } from '../expense-math';
import type { MileageDeduction } from '../mileage-deduction';
import type { DriverContexts } from '../driver-context';
import { createEarningsPolicy } from './earnings';
import { strictObject } from './util';

const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const GROUPS = [
  'trends',
  'rhythm',
  'sources',
  'outlook',
  'efficiency',
  'order_economics',
  'cards',
] as const;
const query = strictObject(
  {
    from: date,
    to: date,
    group: { enum: GROUPS },
    bucket: { enum: ['day', 'week', 'month'] },
    platform: { type: 'string', pattern: '^[a-z0-9_]{1,32}$' },
  },
  [],
);
const DAY = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const calendar = (d: string) => Number.isFinite(utc(d)) && iso(utc(d)) === d;

const ashift = (s: ShiftRow): AShift => ({
  id: s.id,
  localDate: s.localDate,
  startedAt: s.startedAt,
  ms: (s.endedAt ?? s.startedAt) - s.startedAt,
  totalM: s.totalM ?? 0,
  activeM: s.activeM,
  deadheadM: s.deadheadM,
  segmenter: s.segmenter,
});

/** Module `analytics` (18 section 10.1): read-only groups computed from existing tables. No table of its own. */
export function analyticsRoutes({
  db,
  drivers,
  deduction,
  authn,
  override,
}: {
  db: Db;
  drivers: DriverContexts;
  deduction: MileageDeduction;
  authn: Authenticator;
  override?: 'replace' | 'sum';
}) {
  return ({ app, registry }: ServerRouteHost) => {
    const processing = createProcessingRepository(db);

    app.get('/analytics', { schema: { querystring: query } }, async (req) => {
      const { userId } = authn.authenticate(req, 'S');
      const driver = drivers.of(userId);
      const q = req.query as {
        from?: string;
        to?: string;
        group?: (typeof GROUPS)[number];
        bucket?: 'day' | 'week' | 'month';
        platform?: string;
      };
      const today = driver.today();
      const to = q.to ?? today;
      const from = q.from ?? iso(utc(to) - 29 * DAY);
      if (!calendar(from) || !calendar(to) || from > to || (utc(to) - utc(from)) / DAY > 730) {
        throw new ProblemError('validation_failed', 'The request is not valid.', [
          { path: '/from', message: 'give a valid range of at most two years' },
        ]);
      }
      const policy = createEarningsPolicy(drivers, registry, override);
      const earnings = createEarningsRepository(db);
      const eff = (a: string, b: string) =>
        policy.any(userId)
          ? earnings.effective(userId, a, b, policy.options(userId, q.platform))
          : [];
      const length = (utc(to) - utc(from)) / DAY + 1;
      const prevTo = iso(utc(from) - DAY);
      const prevFrom = iso(utc(from) - length * DAY);
      const prevRows = eff(prevFrom, prevTo);

      let expensesCents: number | null = null;
      if (registry.isEnabled('expenses')) {
        expensesCents = 0;
        for (const e of createExpenseRepository(db).between(userId, from, to)) {
          if (!deduction.doubleCounts(userId, e)) expensesCents += deductibleCents(e);
        }
      }
      const result = analytics({
        from,
        to,
        today,
        weekStart: driver.weekStart,
        timeZone: driver.timeZone,
        bucket: q.bucket ?? 'day',
        shifts: processing.shiftsInPeriod(userId, from, to).map(ashift),
        earnings: eff(from, to),
        previousEarningsCents:
          prevRows.length === 0
            ? null
            : prevRows.reduce((a, r) => a + r.grossCents + r.tipsCents + r.bonusCents, 0),
        previousShifts: processing.shiftsInPeriod(userId, prevFrom, prevTo).map(ashift),
        expensesCents,
        setAsideBp: registry.isEnabled('tax')
          ? createTaxRepository(db).year(userId, Number(to.slice(0, 4))).setAsideBp
          : null,
      });
      const group = q.group ?? 'cards';
      return {
        from,
        to,
        group,
        ...(q.platform ? { platform_filter: 'earnings_only' } : {}),
        data: result[group],
      };
    });
  };
}
