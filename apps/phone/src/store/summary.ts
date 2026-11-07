import {
  countryModules,
  mileageDeduction,
  mileageRateSource,
  ownRateDeduction,
  periodStart,
  type OwnRate,
  type VehicleKind,
} from '@milewage/shared';
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
> &
  Partial<Pick<ShiftRow, 'server_deduction_cents' | 'server_deduction_known'>>;

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
 * The server's numbers win: a shift the pull feed has sent uses the server's value (which also
 * knows a vehicle deducted through actual expenses has none). Only shifts the server has not sent
 * are estimated here, from the country's rates or, where it has none, the driver's own rate. The
 * phone holds only the history it has seen, so a tiered rate (Canada's 5,000 km) can be off for
 * those if older shifts of the year are not on this phone. Mileage has no regional data, so the
 * driver's region does not change the estimate.
 */
export function summarize(
  rows: readonly Row[],
  opts: {
    today: string;
    country: string;
    vehicleKinds: ReadonlyMap<number, string>;
    /** The driver's own rate from the settings (plan 21 Q5), used only where the country has none. */
    ownRate?: OwnRate | null;
  },
): HomeSummary {
  const found = countryModules.get(opts.country);
  const own = opts.ownRate ?? null;
  const source = mileageRateSource(found, own);
  const pack = source === 'official' ? found : undefined;
  const done = rows
    .filter((r) => r.status !== 'active' && r.total_m !== null)
    .sort((a, b) => a.local_date.localeCompare(b.local_date) || a.started_at - b.started_at);
  const prior = new Map<string, number>();
  const value = new Map<Row, number | null>();
  for (const r of done) {
    const kind = (opts.vehicleKinds.get(r.vehicle_id) as VehicleKind | undefined) ?? 'car';
    const key = `${kind}|${pack ? periodStart(pack.mileage, r.local_date) : ''}`;
    const before = prior.get(key) ?? 0;
    const local = pack
      ? mileageDeduction(pack, {
          totalM: r.total_m!,
          priorM: before,
          date: r.local_date,
          vehicleKind: kind,
        })
      : source === 'yours'
        ? ownRateDeduction(own!, { totalM: r.total_m!, vehicleKind: kind })
        : null;
    value.set(r, r.server_deduction_known ? (r.server_deduction_cents ?? null) : local);
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
