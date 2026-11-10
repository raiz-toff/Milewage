// The MileIQ preset of the import module: reading a MileIQ drive report saved as CSV. Pure
// functions, no database; the route plans and writes.
//
// The layout, as far as it could be confirmed without a MileIQ account (DECISIONS.md, 2026-11-10):
//
//   rates >>>,business $,0.76,medical $,…            optional rates line
//   SUMMARY                                           a block per vehicle, mostly spreadsheet formulas
//   DETAILED LOG
//   START_DATE*,END_DATE*,CATEGORY*,START*,STOP*,[RATE,]MILES*,MILES_VALUE,PARKING,TOLLS,TOTAL,VEHICLE,PURPOSE,NOTES
//   10/08/2026 13:00,10/08/2026 13:27,Business,"100 Airport Rd, …","200 County Rd 111, …",0.76,19.4,…
//   Totals,,,…                                        then "Report created at MileIQ.com" and a footnote
//
// So the reader finds the header row by its column names (the asterisks and case do not matter),
// reads only the typed cells, ignores the value columns (often formulas), skips the totals and the
// footer, and reports every other row it cannot read, by its line in the file.

import { parseCsvLines } from './csv';

export type DriveClass = 'business' | 'personal' | 'other' | 'unclassified';

/** A date and a wall-clock time as written in the file, before the day order is known. */
export interface WrittenTime {
  /** `iso`: YYYY-MM-DD (unambiguous); `slash`: two numbers then a four-digit year. */
  form: 'iso' | 'slash';
  a: number;
  b: number;
  year: number;
  minutes: number;
}

export interface MileIqDrive {
  line: number;
  start: WrittenTime;
  end: WrittenTime | null;
  category: string;
  cls: DriveClass;
  from: string;
  to: string;
  /** In the file's unit (`MileIqFile.unit`). */
  distance: number;
  /** Minor units of the instance's currency. */
  parking: number;
  tolls: number;
  vehicle: string;
  purpose: string;
  notes: string;
}

export interface MileIqFile {
  unit: 'mi' | 'km';
  /** The file has MileIQ's own value columns (value, rate, total); MileWage works out its own. */
  hasValue: boolean;
  /** What the dates themselves say about the order of day and month; null when every date fits both. */
  dayOrder: 'mdy' | 'dmy' | null;
  /** Both orders appear (one date has a day over 12 first, another second): the file cannot be read. */
  mixedOrder: boolean;
  rows: ({ line: number; drive: MileIqDrive } | { line: number; error: string })[];
}

export class MileIqError extends Error {
  override name = 'MileIqError';
}

const norm = (h: string | undefined) => (h ?? '').toLowerCase().replace(/[^a-z]/g, '');
const DISTANCE: Record<string, 'mi' | 'km'> = {
  miles: 'mi',
  mi: 'mi',
  km: 'km',
  kms: 'km',
  kilometers: 'km',
  kilometres: 'km',
};
const VALUE = new Set(['milesvalue', 'kmvalue', 'value', 'rate', 'total']);

/** The columns the reader uses, by the normalized header name. */
const COLUMNS = {
  start: ['startdate'],
  end: ['enddate'],
  category: ['category'],
  from: ['start'],
  to: ['stop', 'end'],
  parking: ['parking'],
  tolls: ['tolls'],
  vehicle: ['vehicle'],
  purpose: ['purpose'],
  notes: ['notes'],
} as const;

const SLASH =
  /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[\sT,]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?m?\.?)?$/i;
const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[\sT]+(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/;

/** A date with a time; undefined when it is not one (a time is required: MileIQ always writes one). */
export function readTime(text: string): WrittenTime | undefined {
  const t = text.trim();
  const s = SLASH.exec(t);
  const i = s ? undefined : ISO.exec(t);
  const m = s ?? i;
  if (!m || m[4] === undefined) return undefined;
  let h = Number(m[4]);
  const min = Number(m[5]);
  const half = s?.[6]?.toLowerCase();
  if (half) {
    if (h < 1 || h > 12) return undefined;
    h = (h % 12) + (half === 'p' ? 12 : 0);
  }
  if (h > 23 || min > 59) return undefined;
  return s
    ? { form: 'slash', a: Number(m[1]), b: Number(m[2]), year: Number(m[3]), minutes: h * 60 + min }
    : { form: 'iso', a: Number(m[2]), b: Number(m[3]), year: Number(m[1]), minutes: h * 60 + min };
}

/** `YYYY-MM-DD` of a written time in a day order, or undefined when that day does not exist. */
export function dayOf(t: WrittenTime, order: 'mdy' | 'dmy'): string | undefined {
  const [month, day] = t.form === 'iso' || order === 'mdy' ? [t.a, t.b] : [t.b, t.a];
  const d = `${t.year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const ms = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(d) ? d : undefined;
}

/** A distance such as `19.4` or `1,234.5`; undefined for anything else (a formula, a word). */
export function readDistance(text: string): number | undefined {
  const t = text.trim();
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(t)) return undefined;
  return Number(t.replace(/,/g, ''));
}

/** Minor units of a currency (2 for USD, 0 for JPY), from the platform's currency data. */
export function minorDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** An amount such as `5.50`, `$12` or blank (zero) in minor units; undefined when it is not one. */
export function readAmount(text: string, digits: number): number | undefined {
  const t = text.trim().replace(/^[$£€]\s*/, '');
  if (t === '') return 0;
  const shape = digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${digits}})?$`);
  if (!shape.test(t)) return undefined;
  const [whole, frac = ''] = t.split('.');
  return Number(whole) * 10 ** digits + Number(frac.padEnd(digits, '0') || '0');
}

/**
 * The classes of MileIQ's categories. Only "Business" is business distance; personal, commute and
 * MileIQ's medical, charity and moving drives are not business for MileWage's deduction (ADR 0005).
 */
export function classOf(category: string): DriveClass {
  const c = norm(category);
  if (c === 'business') return 'business';
  if (c === 'personal' || c === 'commute' || c === 'personalother') return 'personal';
  if (c === '' || c === 'unclassified') return 'unclassified';
  return 'other';
}

/** The totals row, the footer lines and a repeated header are not drives. */
const NOT_A_DRIVE = /^(totals?\b|report created|\*|for an irs|detailed log|summary)/i;

/** Reads the drive log of a MileIQ CSV report. Throws MileIqError when it is not one. */
export function readMileIq(text: string, currency: string): MileIqFile {
  const all = parseCsvLines(text);
  const headerAt = all.findIndex(
    (r) => r.cells.some((c) => norm(c) === 'startdate') && r.cells.some((c) => norm(c) in DISTANCE),
  );
  if (headerAt < 0) {
    throw new MileIqError(
      'This is not a MileIQ drive report: it has no START_DATE and MILES columns. In MileIQ, download the report as CSV, not PDF or Excel.',
    );
  }
  const header = all[headerAt]!.cells.map(norm);
  const distanceAt = header.findIndex((h) => h in DISTANCE);
  const unit = DISTANCE[header[distanceAt]!]!;
  const col = Object.fromEntries(
    Object.entries(COLUMNS).map(([k, names]) => [
      k,
      header.findIndex((h) => (names as readonly string[]).includes(h)),
    ]),
  ) as Record<keyof typeof COLUMNS, number>;
  if (col.category < 0) throw new MileIqError('The file has no CATEGORY column.');
  const digits = minorDigits(currency);
  const headerKey = header.join(',');

  let mdy = false;
  let dmy = false;
  const note = (t: WrittenTime) => {
    if (t.form !== 'slash') return;
    if (t.a > 12) dmy = true;
    if (t.b > 12) mdy = true;
  };
  const rows: MileIqFile['rows'] = [];
  for (const { line, cells } of all.slice(headerAt + 1)) {
    const cell = (i: number) => (i < 0 ? '' : (cells[i] ?? '').trim());
    if (cells.map(norm).join(',') === headerKey) continue;
    const first = cells.find((c) => c.trim() !== '')?.trim() ?? '';
    const startText = cell(col.start);
    if (startText === '' || NOT_A_DRIVE.test(first)) {
      if (NOT_A_DRIVE.test(first) || cell(distanceAt) === '') continue;
    }
    const start = readTime(startText);
    if (!start) {
      rows.push({
        line,
        error:
          startText === ''
            ? 'the start date is missing'
            : `the start "${startText}" is not a date and time`,
      });
      continue;
    }
    const endText = cell(col.end);
    const end = endText === '' ? null : readTime(endText);
    if (end === undefined) {
      rows.push({ line, error: `the end "${endText}" is not a date and time` });
      continue;
    }
    const distance = readDistance(cell(distanceAt));
    if (distance === undefined) {
      rows.push({ line, error: `the distance "${cell(distanceAt)}" is not a number` });
      continue;
    }
    const parking = readAmount(cell(col.parking), digits);
    const tolls = readAmount(cell(col.tolls), digits);
    if (parking === undefined) {
      rows.push({ line, error: `the parking "${cell(col.parking)}" is not an amount` });
      continue;
    }
    if (tolls === undefined) {
      rows.push({ line, error: `the tolls "${cell(col.tolls)}" is not an amount` });
      continue;
    }
    note(start);
    if (end) note(end);
    const category = cell(col.category);
    rows.push({
      line,
      drive: {
        line,
        start,
        end,
        category,
        cls: classOf(category),
        from: cell(col.from),
        to: cell(col.to),
        distance,
        parking,
        tolls,
        vehicle: cell(col.vehicle),
        purpose: cell(col.purpose),
        notes: cell(col.notes),
      },
    });
  }
  return {
    unit,
    hasValue: header.some((h) => VALUE.has(h)),
    dayOrder: mdy && !dmy ? 'mdy' : dmy && !mdy ? 'dmy' : null,
    mixedOrder: mdy && dmy,
    rows,
  };
}

/** A vehicle cell that names no vehicle ("-unspecified-" in MileIQ, or blank). */
export const unspecified = (name: string) => norm(name) === '' || norm(name) === 'unspecified';

/**
 * Month or day first in the country's numeric dates, from the platform's locale data (CLDR):
 * en-US and en-CA put the month before the day, en-GB and most others the day first.
 */
export function countryDayOrder(country: string): 'mdy' | 'dmy' {
  try {
    const locale = Intl.DateTimeFormat.supportedLocalesOf(`en-${country}`)[0] ?? 'en';
    const parts = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'UTC',
    }).formatToParts(Date.UTC(2026, 9, 8));
    const at = (t: string) => parts.findIndex((p) => p.type === t);
    return at('month') < at('day') ? 'mdy' : 'dmy';
  } catch {
    return 'dmy';
  }
}
