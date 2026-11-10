import type { FastifyInstance } from 'fastify';
import {
  createEarningsRepository,
  createProcessingRepository,
  totalOf,
  type Db,
  type ShiftRow,
} from '../db';
import { summarySeries, type SeriesShift } from '../analytics-series';
import { ProblemError } from '../errors';
import type { MileageDeduction } from '../mileage-deduction';
import type { DriverContexts } from '../driver-context';
import type { EarningsPolicy } from './earnings';
import { strictObject, type AuthFn } from './util';

const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const query = strictObject(
  { from: date, to: date, platform: { type: 'string', pattern: '^[a-z0-9_]{1,32}$' } },
  [],
);

const seriesQuery = strictObject({ from: date, to: date, bucket: { enum: ['day', 'month'] } }, [
  'from',
  'to',
]);
const DAY = 86_400_000;

/** A shift as the series and breakdowns read it: totals not computed yet count as 0. */
export const seriesShift = (s: ShiftRow): SeriesShift => ({
  id: s.id,
  vehicleId: s.vehicleId,
  localDate: s.localDate,
  startedAt: s.startedAt,
  endedAt: s.endedAt ?? s.startedAt,
  totalM: s.totalM ?? 0,
  activeM: s.activeM ?? 0,
  deadheadM: s.deadheadM ?? 0,
  personalM: s.personalM ?? 0,
  segmenter: s.segmenter,
});

const valid = (d: string) => {
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().startsWith(d);
};

export interface SummaryContext {
  db: Db;
  now: () => number;
  auth: AuthFn;
  drivers: DriverContexts;
  deduction: MileageDeduction;
  /** What counts as earnings (labels, typed rows, override rule); absent means nothing does. */
  earnings?: EarningsPolicy;
}

/**
 * `GET /summary`: the three dashboard metrics and what they are made of (08 section 12). Nothing else is exposed.
 * Without `from` and `to` the period is the current month in the owner's time zone.
 */
export function summaryRoute(app: FastifyInstance, ctx: SummaryContext) {
  const repo = createProcessingRepository(ctx.db);

  app.get('/summary', { schema: { querystring: query } }, async (req) => {
    const { userId } = ctx.auth(req, 'S');
    const today = ctx.drivers.of(userId).today();
    const q = req.query as { from?: string; to?: string; platform?: string };
    const to = q.to ?? today;
    const from = q.from ?? `${to.slice(0, 8)}01`;
    const errors = [
      ...(valid(from) ? [] : [{ path: '/from', message: 'is not a calendar date' }]),
      ...(valid(to) ? [] : [{ path: '/to', message: 'is not a calendar date' }]),
    ];
    if (errors.length === 0 && from > to) {
      errors.push({ path: '/from', message: 'must not be after to' });
    }
    if (errors.length)
      throw new ProblemError('validation_failed', 'The request is not valid.', errors);

    const totals = repo.periodTotals(userId, from, to);
    const hours = Math.round((totals.ms / 3_600_000) * 1000) / 1000;
    const deduction = ctx.deduction.ofPeriod(userId, from, to);
    // Earnings come from the driver's labels or typed totals (18 section 4.3); with neither they are null, never 0.
    const rows = ctx.earnings?.any(userId)
      ? createEarningsRepository(ctx.db).effective(
          userId,
          from,
          to,
          ctx.earnings.options(userId, q.platform),
        )
      : [];
    const labelled =
      rows.length === 0
        ? null
        : {
            earningsCents: rows.reduce((a, r) => a + totalOf(r), 0),
            tipsCents: rows.reduce((a, r) => a + r.tipsCents, 0),
          };
    return {
      from,
      to,
      shift_count: totals.shift_count,
      hours,
      earnings_cents: labelled?.earningsCents ?? null,
      tips_cents: labelled?.tipsCents ?? null,
      active_m: totals.active_m,
      deadhead_m: totals.deadhead_m,
      personal_m: totals.personal_m,
      total_m: totals.total_m,
      // Each shift's value from the rate of its own date; null without a pack or a rate.
      deduction_cents: deduction.cents,
      // The country's rate, your rate, or both by date (ADR 0007).
      deduction_rate: deduction.rate,
      hourly_earnings_cents:
        labelled && hours > 0 ? Math.round(labelled.earningsCents / hours) : null,
      // A shift that spans platforms has one distance; it is not split, so only earnings are filtered.
      ...(q.platform ? { platform_filter: 'earnings_only' } : {}),
    };
  });

  /**
   * `GET /summary/series`: the summary's figures per day or per month, every slot of the range
   * included, for the dashboard's and Analytics' charts. At most 366 days by day, two years by month.
   */
  app.get('/summary/series', { schema: { querystring: seriesQuery } }, async (req) => {
    const { userId } = ctx.auth(req, 'S');
    const q = req.query as { from: string; to: string; bucket?: 'day' | 'month' };
    const bucket = q.bucket ?? 'day';
    const days =
      valid(q.from) && valid(q.to)
        ? (Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`)) / DAY + 1
        : 0;
    if (days < 1 || days > (bucket === 'day' ? 366 : 731)) {
      throw new ProblemError('validation_failed', 'The request is not valid.', [
        {
          path: '/from',
          message:
            bucket === 'day'
              ? 'give a valid range of at most 366 days'
              : 'give a valid range of at most two years',
        },
      ]);
    }
    const known = ctx.earnings?.any(userId) ?? false;
    return summarySeries({
      from: q.from,
      to: q.to,
      bucket,
      shifts: repo.shiftsInPeriod(userId, q.from, q.to).map(seriesShift),
      earnings: known
        ? createEarningsRepository(ctx.db).effective(
            userId,
            q.from,
            q.to,
            ctx.earnings!.options(userId),
          )
        : [],
      earningsKnown: known,
    });
  });
}
