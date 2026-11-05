import { countryPacks, type VehicleKind } from '@milewage/shared';
import type { ShiftRow } from './shiftStore';

export interface PeriodSummary {
  from: string;
  to: string;
  shifts: number;
  /** Shifts in the period that are not on the server yet. */
  unsynced: number;
  totalM: number;
  /** Deduction value in cents, or null when the country has no rate for these dates (never a guess). */
  deductionCents: number | null;
}

export interface HomeSummary {
  week: PeriodSummary;
  month: PeriodSummary;
}

type Row = Pick<
  ShiftRow,
  'local_date' | 'started_at' | 'status' | 'total_m' | 'vehicle_id' | 'sync_state'
>;

/** Monday of the week containing a `YYYY-MM-DD` date. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/**
 * Week and month figures from the shifts on this phone (15 section 4: unsynced shifts included,
 * with a count). Same meaning as the web dashboard: only ended or finalized shifts count, the
 * deduction is each shift's value from the country pack (07 section 3) with the business metres
 * already driven in the same rate period, summed over the period; null when no rate applies.
 * The phone holds only the history it has seen, so a tiered rate (Canada's 5,000 km) can be
 * off if older shifts of the year are not on this phone.
 */
export function summarize(
  rows: readonly Row[],
  opts: { today: string; country: string; vehicleKinds: ReadonlyMap<number, string> },
): HomeSummary {
  const pack = countryPacks.get(opts.country);
  const done = rows
    .filter((r) => r.status !== 'active' && r.total_m !== null)
    .sort((a, b) => a.local_date.localeCompare(b.local_date) || a.started_at - b.started_at);
  const prior = new Map<string, number>();
  const value = new Map<Row, number | null>();
  for (const r of done) {
    const kind = (opts.vehicleKinds.get(r.vehicle_id) as VehicleKind | undefined) ?? 'car';
    const key = `${kind}|${pack?.periodStart(r.local_date) ?? ''}`;
    const before = prior.get(key) ?? 0;
    value.set(
      r,
      pack
        ? pack.deduction({
            totalM: r.total_m!,
            priorM: before,
            date: r.local_date,
            vehicleKind: kind,
          })
        : null,
    );
    prior.set(key, before + r.total_m!);
  }
  const period = (from: string): PeriodSummary => {
    const inside = done.filter((r) => r.local_date >= from && r.local_date <= opts.today);
    const priced = inside.map((r) => value.get(r)).filter((v): v is number => v != null);
    return {
      from,
      to: opts.today,
      shifts: inside.length,
      unsynced: inside.filter((r) => r.sync_state !== 'on_server').length,
      totalM: inside.reduce((a, r) => a + r.total_m!, 0),
      deductionCents: priced.length > 0 ? priced.reduce((a, b) => a + b, 0) : null,
    };
  };
  return {
    week: period(weekStart(opts.today)),
    month: period(`${opts.today.slice(0, 7)}-01`),
  };
}
