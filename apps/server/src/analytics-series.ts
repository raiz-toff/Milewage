import type { EffectiveRow } from './db';
import { totalOf } from './db';

// The series the web's charts draw (plan 18 section 10.1): figures per day or per month for a
// range. Read-only, computed from the same rows as `/summary`; unknown is null, never 0.

const DAY = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** Hours from milliseconds, to three decimals as `/summary` gives them. */
const hoursOf = (ms: number) => Math.round((ms / 3_600_000) * 1000) / 1000;

/** What the series reads of a shift. */
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
