import type { EffectiveRow } from './db';
import { totalOf } from './db';

// The series the web's charts draw (plan 18 section 10.1): figures per day or per month for a
// range, and the breakdowns of a range by time of week, vehicle, platform and expense category.
// Read-only, computed from the same rows as `/summary` and `/analytics`; unknown is null, never 0.

const DAY = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** Hours from milliseconds, to three decimals as `/summary` gives them. */
const hoursOf = (ms: number) => Math.round((ms / 3_600_000) * 1000) / 1000;

/** What the series and breakdowns read of a shift. */
export interface SeriesShift {
  id: number;
  vehicleId: number | null;
  localDate: string;
  startedAt: number;
  endedAt: number;
  totalM: number;
  activeM: number;
  deadheadM: number;
  personalM: number;
  segmenter: 'stops' | 'whole_shift';
}

export type SeriesBucket = 'day' | 'month';

/** Every day (or month) from `from` to `to`, both included, as the bucket's first day. */
export function bucketStarts(from: string, to: string, bucket: SeriesBucket): string[] {
  const out: string[] = [];
  if (bucket === 'day') {
    for (let t = utc(from); t <= utc(to); t += DAY) out.push(iso(t));
    return out;
  }
  let [y, m] = from.split('-').map(Number) as [number, number];
  const last = to.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (key > last) break;
    out.push(`${key}-01`);
    m += 1;
    if (m === 13) [y, m] = [y + 1, 1];
  }
  return out;
}

const keyOf = (date: string, bucket: SeriesBucket) =>
  bucket === 'day' ? date : `${date.slice(0, 7)}-01`;

/**
 * One row per day or month of the range, empty ones included, so a chart has every slot. A bucket
 * with shifts but nothing entered or labelled has null earnings; one with no shifts and no
 * earnings has 0. `unsplit_m` is the business distance of shifts with no stop-based split (it sits
 * in `active_m`), so the estimated split can be told from a whole-shift one.
 */
export function summarySeries(i: {
  from: string;
  to: string;
  bucket: SeriesBucket;
  shifts: SeriesShift[];
  earnings: EffectiveRow[];
  /** False when nothing can count as earnings (module off and stops off): every bucket is null. */
  earningsKnown: boolean;
}) {
  const rows = new Map(
    bucketStarts(i.from, i.to, i.bucket).map((start) => [
      start,
      {
        shifts: [] as SeriesShift[],
        earnings: [] as EffectiveRow[],
      },
    ]),
  );
  for (const s of i.shifts) rows.get(keyOf(s.localDate, i.bucket))?.shifts.push(s);
  for (const e of i.earnings) rows.get(keyOf(e.localDate, i.bucket))?.earnings.push(e);
  return {
    from: i.from,
    to: i.to,
    bucket: i.bucket,
    buckets: [...rows].map(([start, b]) => {
      const byPlatform = new Map<string, { earnings: number; tips: number }>();
      for (const r of b.earnings) {
        const p = byPlatform.get(r.platform) ?? { earnings: 0, tips: 0 };
        p.earnings += totalOf(r);
        p.tips += r.tipsCents;
        byPlatform.set(r.platform, p);
      }
      const nothing = b.earnings.length === 0;
      const earnings =
        !i.earningsKnown || (nothing && b.shifts.length > 0) ? null : sum(b.earnings.map(totalOf));
      return {
        start,
        shift_count: b.shifts.length,
        hours: hoursOf(sum(b.shifts.map((s) => s.endedAt - s.startedAt))),
        earnings_cents: earnings,
        tips_cents: earnings === null ? null : sum(b.earnings.map((r) => r.tipsCents)),
        active_m: sum(b.shifts.map((s) => s.activeM)),
        deadhead_m: sum(b.shifts.map((s) => s.deadheadM)),
        personal_m: sum(b.shifts.map((s) => s.personalM)),
        total_m: sum(b.shifts.map((s) => s.totalM)),
        unsplit_m: sum(
          b.shifts.filter((s) => s.segmenter !== 'stops').map((s) => s.activeM + s.deadheadM),
        ),
        platforms: [...byPlatform]
          .map(([platform, p]) => ({ platform, earnings_cents: p.earnings, tips_cents: p.tips }))
          .sort(
            (a, b) => b.earnings_cents - a.earnings_cents || a.platform.localeCompare(b.platform),
          ),
      };
    }),
  };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Splits [start, end) into the local clock hours it covers in `timeZone`: weekday (0 Sunday), hour
 * and milliseconds. Steps hour boundary by hour boundary, so a DST change or a half-hour zone lands
 * each minute in the hour the driver's clock showed.
 */
export function clockHours(start: number, end: number, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const out: { weekday: number; hour: number; ms: number }[] = [];
  let t = start;
  while (t < end) {
    const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, x.value]));
    const into = (Number(p.minute) * 60 + Number(p.second)) * 1000 + (t % 1000);
    const next = Math.min(end, t + 3_600_000 - into);
    out.push({ weekday: WEEKDAYS.indexOf(p.weekday!), hour: Number(p.hour) % 24, ms: next - t });
    t = next;
  }
  return out;
}

export interface BreakdownExpense {
  category: string;
  vehicleId: number | null;
  cents: number;
}

/**
 * The range broken down for Analytics: shift time and earnings by weekday and clock hour, and the
 * figures per vehicle, per platform and per expense category. A shift's earnings are spread over
 * its hours in proportion to time (the screen says so), so a cell's pay per hour is the time-weighted
 * average of the shifts that covered it. `expenses` is null when the expenses module is off.
 */
export function breakdown(i: {
  from: string;
  to: string;
  timeZone: string;
  shifts: SeriesShift[];
  earnings: EffectiveRow[];
  expenses: BreakdownExpense[] | null;
}) {
  const earnedBy = new Map<number, number>();
  for (const r of i.earnings) earnedBy.set(r.shiftId, (earnedBy.get(r.shiftId) ?? 0) + totalOf(r));

  const cells = new Map<
    string,
    { weekday: number; hour: number; ms: number; paidMs: number; cents: number }
  >();
  for (const s of i.shifts) {
    const length = s.endedAt - s.startedAt;
    if (length <= 0) continue;
    const earned = earnedBy.get(s.id);
    for (const c of clockHours(s.startedAt, s.endedAt, i.timeZone)) {
      const key = `${c.weekday}:${c.hour}`;
      const cell = cells.get(key) ?? {
        weekday: c.weekday,
        hour: c.hour,
        ms: 0,
        paidMs: 0,
        cents: 0,
      };
      cell.ms += c.ms;
      if (earned !== undefined) {
        cell.paidMs += c.ms;
        cell.cents += (earned * c.ms) / length;
      }
      cells.set(key, cell);
    }
  }
  const week_hours = [...cells.values()]
    .sort((a, b) => a.weekday - b.weekday || a.hour - b.hour)
    .map((c) => ({
      weekday: c.weekday,
      hour: c.hour,
      hours: hoursOf(c.ms),
      paid_hours: hoursOf(c.paidMs),
      earnings_cents: c.paidMs > 0 ? Math.round(c.cents) : null,
    }));

  const vehicleIds = [...new Set(i.shifts.map((s) => s.vehicleId))];
  const vehicles = vehicleIds
    .map((vehicleId) => {
      const ss = i.shifts.filter((s) => s.vehicleId === vehicleId);
      const paid = ss.filter((s) => earnedBy.has(s.id));
      return {
        vehicle_id: vehicleId,
        shifts: ss.length,
        hours: hoursOf(sum(ss.map((s) => s.endedAt - s.startedAt))),
        business_m: sum(ss.map((s) => s.activeM + s.deadheadM)),
        personal_m: sum(ss.map((s) => s.personalM)),
        earnings_cents: paid.length === 0 ? null : sum(paid.map((s) => earnedBy.get(s.id)!)),
        ...(i.expenses === null
          ? {}
          : {
              expenses_cents: sum(
                i.expenses.filter((e) => e.vehicleId === vehicleId).map((e) => e.cents),
              ),
            }),
      };
    })
    .sort((a, b) => b.business_m - a.business_m || (a.vehicle_id ?? 0) - (b.vehicle_id ?? 0));

  const byPlatform = new Map<
    string,
    {
      earnings: number;
      tips: number;
      orders: number | null;
      online: number | null;
      shifts: Set<number>;
    }
  >();
  for (const r of i.earnings) {
    const p = byPlatform.get(r.platform) ?? {
      earnings: 0,
      tips: 0,
      orders: null,
      online: null,
      shifts: new Set<number>(),
    };
    p.earnings += totalOf(r);
    p.tips += r.tipsCents;
    if (r.orders !== null) p.orders = (p.orders ?? 0) + r.orders;
    if (r.onlineMin !== null) p.online = (p.online ?? 0) + r.onlineMin;
    p.shifts.add(r.shiftId);
    byPlatform.set(r.platform, p);
  }
  const platforms = [...byPlatform]
    .map(([platform, p]) => ({
      platform,
      earnings_cents: p.earnings,
      tips_cents: p.tips,
      orders: p.orders,
      online_minutes: p.online,
      shifts: p.shifts.size,
    }))
    .sort((a, b) => b.earnings_cents - a.earnings_cents || a.platform.localeCompare(b.platform));

  const byCategory = new Map<string, { cents: number; count: number }>();
  for (const e of i.expenses ?? []) {
    const c = byCategory.get(e.category) ?? { cents: 0, count: 0 };
    c.cents += e.cents;
    c.count += 1;
    byCategory.set(e.category, c);
  }
  const expense_categories = [...byCategory]
    .map(([category, c]) => ({ category, cents: c.cents, count: c.count }))
    .filter((c) => c.cents > 0)
    .sort((a, b) => b.cents - a.cents || a.category.localeCompare(b.category));

  return {
    from: i.from,
    to: i.to,
    week_hours,
    vehicles,
    platforms,
    ...(i.expenses === null ? {} : { expense_categories }),
  };
}
