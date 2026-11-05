import type { GoalMetric, GoalPeriod, GoalRow } from './db';

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);

/**
 * The local dates `[from, to]` of the period that contains `today`. Weeks start on `weekStart`
 * (0 Sunday, 1 Monday, from the settings); months and years are calendar ones.
 */
export function periodRange(
  period: GoalPeriod,
  today: string,
  weekStart: number,
): { from: string; to: string } {
  const t = utc(today);
  if (period === 'daily') return { from: today, to: today };
  if (period === 'weekly') {
    const back = (new Date(t).getUTCDay() - weekStart + 7) % 7;
    return { from: iso(t - back * DAY), to: iso(t - back * DAY + 6 * DAY) };
  }
  const [y, m] = today.split('-').map(Number) as [number, number];
  if (period === 'monthly') {
    return { from: iso(Date.UTC(y, m - 1, 1)), to: iso(Date.UTC(y, m, 0)) };
  }
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

export interface GoalFigures {
  /** Effective earnings of the range in cents; null when none were entered or labelled. */
  earningsCents(from: string, to: string): number | null;
  /** Ended and finalized shifts of the range. */
  shifts(from: string, to: string): { ms: number; activeM: number | null; segmenter: string }[];
}

export interface GoalProgress {
  value: number | null;
  target: number;
  ratio: number | null;
  period_from: string;
  period_to: string;
  /** True for the stop-based split of distance (14 section 6): shown labelled "estimated". */
  estimated: boolean;
  /** Why `value` is null, in words the screen can show. */
  note: string | null;
}

/** Progress at read time from the same sources as `GET /summary` (18 section 8.1). */
export function goalProgress(
  g: GoalRow,
  today: string,
  weekStart: number,
  f: GoalFigures,
): GoalProgress {
  const { from, to } = periodRange(g.period, today, weekStart);
  const metric: GoalMetric = g.metric;
  let value: number | null;
  let note: string | null = null;
  let estimated = false;
  if (metric === 'earnings') {
    value = f.earningsCents(from, to);
    if (value === null) note = 'no earnings entered';
  } else {
    const shifts = f.shifts(from, to);
    if (metric === 'shifts') value = shifts.length;
    else if (metric === 'hours') value = Math.round(shifts.reduce((a, s) => a + s.ms, 0) / 60_000);
    else {
      estimated = true;
      const split = shifts.filter((s) => s.segmenter === 'stops' && s.activeM !== null);
      if (shifts.length > 0 && split.length === 0) {
        value = null;
        note = 'no stop-based split for these shifts';
      } else value = split.reduce((a, s) => a + (s.activeM ?? 0), 0);
    }
  }
  return {
    value,
    target: g.target,
    ratio: value === null ? null : value / g.target,
    period_from: from,
    period_to: to,
    estimated,
    note,
  };
}
