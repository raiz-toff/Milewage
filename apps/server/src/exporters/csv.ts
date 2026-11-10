import { localDate } from '../time';
import { createOdometerChecks } from './odometer';
import type { ExportContext, Exporter } from './registry';

const CRLF = '\r\n';
const M_PER: Record<'km' | 'mi', number> = { km: 1000, mi: 1609.344 };

/**
 * One CSV cell (RFC 4180). Text that a spreadsheet would run as a formula (= + - @, tab, CR) gets a leading
 * apostrophe; numbers are written by the caller as numbers and never pass through here.
 */
export function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
const row = (cells: (string | number | null | undefined)[]) => cells.map(cell).join(',') + CRLF;

const timeOf = (at: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(at);
const degrees = (e7: number | null) => (e7 === null ? '' : (e7 / 1e7).toFixed(6));
const place = (lat: number | null, lon: number | null) =>
  lat === null || lon === null ? '' : `${degrees(lat)} ${degrees(lon)}`;
export const distance = (m: number, unit: 'km' | 'mi') => Math.round((m / M_PER[unit]) * 100) / 100;
export const money = (cents: number) => (cents / 100).toFixed(2);

function* tripLevel(c: ExportContext) {
  yield row([
    'date',
    'start_time',
    'end_time',
    'vehicle',
    'kind',
    'platform',
    'purpose',
    'start_location',
    'end_location',
    'distance',
    'distance_unit',
    'source',
  ]);
  for (const s of c.shifts) {
    const labels = c.driver.stopsOn ? c.readers.labels(s.id) : [];
    const stops = c.driver.stopsOn ? c.readers.stops(s.id) : [];
    for (const t of c.readers.trips(s.id)) {
      // The platform of the stop that opened an active segment: the stop the rider left when it began.
      const opener = stops.find((p) => p.endedAt === t.startedAt || p.startedAt === t.startedAt);
      const platform =
        t.kind === 'active' ? labels.find((l) => l.stopKey === opener?.stopKey)?.platform : null;
      // Under the stop-based segmenter the active/deadhead split is an estimate (14 section 6).
      const estimated = s.segmenter === 'stops' && t.source === 'auto' && t.editedAt === null;
      yield row([
        localDate(t.startedAt, c.driver.timeZone),
        timeOf(t.startedAt, c.driver.timeZone),
        timeOf(t.endedAt, c.driver.timeZone),
        c.vehicles.get(s.vehicleId)?.name ?? '',
        estimated && t.kind !== 'personal' ? `${t.kind} (estimated)` : t.kind,
        platform ?? '',
        t.purpose,
        place(t.startLatE7, t.startLonE7),
        place(t.endLatE7, t.endLonE7),
        distance(t.distanceM, c.driver.unit),
        c.driver.unit,
        t.source,
      ]);
    }
  }
}

function* shiftLevel(c: ExportContext) {
  const u = c.driver.unit === 'mi' ? 'Miles' : 'Km';
  // A value at the driver's own rate is labelled as theirs, never as an official deduction (Q5):
  // the column says so when every value is at your rate, and each row names its rate (ADR 0007).
  const rates = new Set(c.shifts.map((s) => c.readers.deduction(s).rate).filter((r) => r !== null));
  const yours = rates.size === 1 && rates.has('yours');
  yield row([
    'Date',
    'Shift_ID',
    'Vehicle_ID',
    'Start_Time',
    'End_Time',
    'Start_Location',
    'End_Location',
    'Platform',
    'Deliveries_Completed',
    'Gross_Pay',
    'Tips',
    `Active_${u}`,
    `Deadhead_${u}`,
    `Total_${u}`,
    yours ? 'Deduction_Value_Your_Rate' : 'Deduction_Value',
    'Split_Estimated',
    'Notes',
    `Odometer_Start_${u}`,
    `Odometer_End_${u}`,
    'Odometer_Check',
    'Year_Odometer_Check',
    'Bonus',
    'Imported',
    'Deduction_Rate',
  ]);
  const odometer = createOdometerChecks(c.db, c.userId, c.driver.timeZone);
  // A shift made from a CSV file has a typed distance, not a tracked one; every export says so (18 section 12).
  const imported = new Map(
    (
      c.db
        .prepare("SELECT shift_id FROM shift_flags WHERE user_id = ? AND code = 'imported'")
        .pluck()
        .all(c.userId) as number[]
    ).map((id) => [id, true]),
  );
  for (const s of c.shifts) {
    const trips = c.readers.trips(s.id);
    const labels = c.driver.stopsOn ? c.readers.labels(s.id) : [];
    // Money and counts come only from the driver's labels; with none they stay blank, never 0.
    const earned = c.readers.earnings(s);
    const paid = earned.length > 0;
    const sum = (f: (r: (typeof earned)[number]) => number) => earned.reduce((a, r) => a + f(r), 0);
    const platforms = [
      ...new Set(
        [...labels.map((l) => l.platform), ...earned.map((r) => r.platform)].filter(Boolean),
      ),
    ].join(';');
    const orders = earned.some((r) => r.orders !== null) ? sum((r) => r.orders ?? 0) : null;
    const first = trips[0];
    const last = trips.at(-1);
    const dv = c.readers.deduction(s);
    const odo = odometer.shift(s);
    yield row([
      s.localDate,
      s.id,
      s.vehicleId,
      timeOf(s.startedAt, c.driver.timeZone),
      s.endedAt === null ? '' : timeOf(s.endedAt, c.driver.timeZone),
      place(first?.startLatE7 ?? null, first?.startLonE7 ?? null),
      place(last?.endLatE7 ?? null, last?.endLonE7 ?? null),
      platforms,
      orders ?? (labels.length > 0 ? labels.filter((l) => l.role === 'dropoff').length : ''),
      paid ? money(sum((r) => r.grossCents)) : '',
      paid ? money(sum((r) => r.tipsCents)) : '',
      s.activeM === null ? '' : distance(s.activeM, c.driver.unit),
      s.deadheadM === null ? '' : distance(s.deadheadM, c.driver.unit),
      s.totalM === null ? '' : distance(s.totalM, c.driver.unit),
      dv.cents === null ? '' : money(dv.cents),
      s.segmenter === 'stops' ? 'yes' : 'no',
      s.notes,
      odo.startM === null ? '' : distance(odo.startM, c.driver.unit),
      odo.endM === null ? '' : distance(odo.endM, c.driver.unit),
      odo.check,
      odometer.year(s),
      paid ? money(sum((r) => r.bonusCents)) : '',
      imported.get(s.id) ? 'yes' : '',
      dv.rate === 'yours' ? 'your rate' : dv.rate === 'official' ? 'country rate' : '',
    ]);
  }
}

/** The generic CSV in two levels: the audit record (one row per trip) and the accountant's file (one per shift). */
export const csvExporter: Exporter = {
  format: 'csv',
  contentType: 'text/csv; charset=utf-8',
  extension: 'csv',
  requires: [],
  run: (c) => (c.level === 'shift' ? shiftLevel(c) : tripLevel(c)),
};
