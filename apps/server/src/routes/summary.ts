import type { FastifyInstance } from 'fastify';
import {
  createEarningsRepository,
  createProcessingRepository,
  createSettingsRepository,
  totalOf,
  type Db,
} from '../db';
import { ProblemError } from '../errors';
import { deductionOfShift } from '../processing/presenter';
import { localDate } from '../time';
import type { EarningsPolicy } from './earnings';
import { strictObject, type AuthFn } from './util';

const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const query = strictObject(
  { from: date, to: date, platform: { type: 'string', pattern: '^[a-z0-9_]{1,32}$' } },
  [],
);

const valid = (d: string) => {
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().startsWith(d);
};

/** Sum of the shifts' deduction values (each from the pack of its own date); null without a pack or a rate. */
function deduction(db: Db, userId: number, from: string, to: string): number | null {
  const values = createProcessingRepository(db)
    .shiftsInPeriod(userId, from, to)
    .map((s) => deductionOfShift(db, s))
    .filter((v): v is number => v !== null);
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
}

export interface SummaryContext {
  db: Db;
  now: () => number;
  auth: AuthFn;
  /** What counts as earnings (labels, typed rows, override rule); absent means nothing does. */
  earnings?: EarningsPolicy;
}

/**
 * `GET /summary`: the three dashboard metrics and what they are made of (08 section 12). Nothing else is exposed.
 * Without `from` and `to` the period is the current month in the owner's time zone.
 */
export function summaryRoute(app: FastifyInstance, ctx: SummaryContext) {
  const repo = createProcessingRepository(ctx.db);
  const settings = createSettingsRepository(ctx.db);

  app.get('/summary', { schema: { querystring: query } }, async (req) => {
    const { userId } = ctx.auth(req, 'S');
    const prefs = settings.get(userId);
    if (!prefs) throw new ProblemError('setup_incomplete', 'Finish setup first.');
    const q = req.query as { from?: string; to?: string; platform?: string };
    const today = localDate(ctx.now(), prefs.timezone);
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
      deduction_cents: deduction(ctx.db, userId, from, to),
      hourly_earnings_cents:
        labelled && hours > 0 ? Math.round(labelled.earningsCents / hours) : null,
      // A shift that spans platforms has one distance; it is not split, so only earnings are filtered.
      ...(q.platform ? { platform_filter: 'earnings_only' } : {}),
    };
  });
}
