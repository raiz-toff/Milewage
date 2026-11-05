import type { EffectiveRow } from './db';
import { totalOf } from './db';

const DAY = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export interface AShift {
  id: number;
  localDate: string;
  startedAt: number;
  ms: number;
  totalM: number;
  activeM: number | null;
  deadheadM: number | null;
  segmenter: string;
}

export interface AnalyticsInput {
  from: string;
  to: string;
  today: string;
  weekStart: number;
  timeZone: string;
  bucket: 'day' | 'week' | 'month';
  shifts: AShift[];
  earnings: EffectiveRow[];
  /** Earnings of the previous period of the same length, null when none. */
  previousEarningsCents: number | null;
  previousShifts: AShift[];
  expensesCents: number | null;
  setAsideBp: number | null;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const earned = (rows: EffectiveRow[]) => (rows.length === 0 ? null : sum(rows.map(totalOf)));
const hours = (s: AShift[]) => Math.round((sum(s.map((x) => x.ms)) / 3_600_000) * 100) / 100;

function bucketKey(date: string, bucket: 'day' | 'week' | 'month', weekStart: number): string {
  if (bucket === 'day') return date;
  if (bucket === 'month') return date.slice(0, 7);
  const t = utc(date);
  return iso(t - ((new Date(t).getUTCDay() - weekStart + 7) % 7) * DAY);
}

/** The groups of 18 section 10.1. Everything is read-only and computed from existing tables; unknown is null, never 0. */
export function analytics(i: AnalyticsInput) {
  const { shifts, earnings } = i;
  const hourOf = (ms: number) =>
    Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: i.timeZone,
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(ms),
    );

  const keys = new Set([...shifts.map((s) => s.localDate), ...earnings.map((e) => e.localDate)]);
  const trends = {
    bucket: i.bucket,
    buckets: [...new Set([...keys].map((d) => bucketKey(d, i.bucket, i.weekStart)))]
      .sort()
      .map((start) => {
        const inB = (d: string) => bucketKey(d, i.bucket, i.weekStart) === start;
        const ss = shifts.filter((s) => inB(s.localDate));
        const e = earned(earnings.filter((r) => inB(r.localDate)));
        const h = hours(ss);
        return {
          start,
          shifts: ss.length,
          hours: h,
          distance_m: sum(ss.map((s) => s.totalM)),
          earnings_cents: e,
          hourly_cents: e !== null && h > 0 ? Math.round(e / h) : null,
        };
      }),
    previous: {
      earnings_cents: i.previousEarningsCents,
      hours: hours(i.previousShifts),
      distance_m: sum(i.previousShifts.map((s) => s.totalM)),
    },
  };

  const byDow = Array.from({ length: 7 }, () => ({ shifts: 0, hours: 0 }));
  const byHour = Array.from({ length: 24 }, () => ({ shifts: 0 }));
  for (const s of shifts) {
    const d = new Date(utc(s.localDate)).getUTCDay();
    byDow[d]!.shifts += 1;
    byDow[d]!.hours += s.ms / 3_600_000;
    byHour[hourOf(s.startedAt)]!.shifts += 1;
  }
  const rhythm = {
    // index 0 is Sunday; the screen orders them from the week start
    by_weekday: byDow.map((x, weekday) => ({
      weekday,
      shifts: x.shifts,
      hours: Math.round(x.hours * 100) / 100,
    })),
    by_start_hour: byHour.map((x, hour) => ({ hour, shifts: x.shifts })),
    average_shift_minutes:
      shifts.length === 0
        ? null
        : Math.round(sum(shifts.map((s) => s.ms)) / 60_000 / shifts.length),
  };

  const total = earned(earnings);
  const byPlatform = new Map<string, { earnings: number; tips: number }>();
  for (const r of earnings) {
    const p = byPlatform.get(r.platform) ?? { earnings: 0, tips: 0 };
    p.earnings += totalOf(r);
    p.tips += r.tipsCents;
    byPlatform.set(r.platform, p);
  }
  const sources = [...byPlatform]
    .map(([platform, p]) => ({
      platform,
      earnings_cents: p.earnings,
      tips_cents: p.tips,
      share: total ? Math.round((p.earnings / total) * 1000) / 1000 : null,
    }))
    .sort((a, b) => b.earnings_cents - a.earnings_cents);

  // A straight-line projection of the period's end from the days elapsed; none under three shifts.
  const end = i.today < i.to ? i.today : i.to;
  const elapsed = Math.max(1, (utc(end) - utc(i.from)) / DAY + 1);
  const length = (utc(i.to) - utc(i.from)) / DAY + 1;
  const outlook =
    shifts.length < 3 || total === null
      ? {
          projected_earnings_cents: null,
          days_left: Math.max(0, length - elapsed),
          note: 'fewer than 3 shifts or no earnings',
        }
      : {
          projected_earnings_cents: Math.round((total / elapsed) * length),
          days_left: Math.max(0, length - elapsed),
          note: 'straight-line projection',
        };

  const split = shifts.filter(
    (s) => s.segmenter === 'stops' && s.activeM !== null && s.deadheadM !== null,
  );
  const act = sum(split.map((s) => s.activeM ?? 0));
  const dead = sum(split.map((s) => s.deadheadM ?? 0));
  const perShift = shifts
    .map((s) => {
      const e = earned(earnings.filter((r) => r.shiftId === s.id));
      return e !== null && s.ms > 0 ? e / (s.ms / 3_600_000) : null;
    })
    .filter((v): v is number => v !== null);
  const mean = perShift.length ? sum(perShift) / perShift.length : 0;
  const efficiency = {
    estimated: true,
    active_share:
      split.length > 0 && act + dead > 0 ? Math.round((act / (act + dead)) * 1000) / 1000 : null,
    deadhead_share:
      split.length > 0 && act + dead > 0 ? Math.round((dead / (act + dead)) * 1000) / 1000 : null,
    // spread of $/hour across shifts as a fraction of the mean (lower is steadier)
    hourly_spread:
      perShift.length >= 2 && mean > 0
        ? Math.round(
            (Math.sqrt(sum(perShift.map((v) => (v - mean) ** 2)) / perShift.length) / mean) * 1000,
          ) / 1000
        : null,
  };

  const orders = earnings.some((r) => r.orders !== null)
    ? sum(earnings.map((r) => r.orders ?? 0))
    : null;
  const distanceM = sum(shifts.map((s) => s.totalM));
  const totalH = sum(shifts.map((s) => s.ms)) / 3_600_000;
  const order_economics =
    orders === null || orders === 0 || total === null
      ? null
      : {
          orders,
          pay_per_order_cents: Math.round(total / orders),
          pay_per_km_cents: distanceM > 0 ? Math.round(total / (distanceM / 1000)) : null,
          pay_per_mile_cents: distanceM > 0 ? Math.round(total / (distanceM / 1609.344)) : null,
          orders_per_hour: totalH > 0 ? Math.round((orders / totalH) * 100) / 100 : null,
        };

  const online = earnings.filter((r) => r.onlineMin !== null);
  const onlineH = sum(online.map((r) => r.onlineMin ?? 0)) / 60;
  const setAside =
    total !== null && i.setAsideBp !== null ? Math.round((total * i.setAsideBp) / 10_000) : null;
  const cards = {
    gross_cents: total,
    ...(i.expensesCents === null
      ? {}
      : {
          expenses_cents: i.expensesCents,
          burn_ratio: total ? Math.round((i.expensesCents / total) * 1000) / 1000 : null,
          net_take_home_cents: total === null ? null : total - i.expensesCents - (setAside ?? 0),
        }),
    ...(setAside === null && i.setAsideBp === null ? {} : { tax_set_aside_cents: setAside }),
    hourly_shift_cents: total !== null && totalH > 0 ? Math.round(total / totalH) : null,
    hourly_online_cents:
      total !== null && onlineH > 0 ? Math.round(sum(online.map(totalOf)) / onlineH) : null,
    total_hours: Math.round(totalH * 100) / 100,
  };

  return { trends, rhythm, sources, outlook, efficiency, order_economics, cards };
}
export type Analytics = ReturnType<typeof analytics>;
