// The driver's day. A calendar day is a `YYYY-MM-DD` string in the driver's time zone
// (settings.timezone), never the browser's; weeks start on settings.week_start (0 Sunday, 1 Monday).
// Everything that turns an instant into a day, steps days, or finds a week, month, year or period
// lives here, so a time-zone or week-start rule is fixed once. Nothing here parses a day with
// `new Date(text)` (which reads it as UTC midnight and can land on the day before), and no day is
// taken from `toISOString()` of the browser's clock.

const pad = (n: number) => String(n).padStart(2, '0');

/** The day as a local Date at noon, for the calendar; noon so no time-zone or DST change moves it. */
function day(y: number, m: number, d: number): Date | undefined {
  const date = new Date(y, m - 1, d, 12);
  return y >= 1000 && date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
    ? date
    : undefined;
}

export function isoToDate(iso: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? day(Number(m[1]), Number(m[2]), Number(m[3])) : undefined;
}

export const dateToIso = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const DAY_MS = 86_400_000;
/** A day's midnight in UTC: day arithmetic on that clock has no DST and no browser zone in it. */
const utcOf = (day: string) => Date.parse(`${day}T00:00:00Z`);
const dayAtUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The day the instant `ms` falls on in `timeZone`. */
export const dayOf = (ms: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(ms);

/** Today in the driver's time zone (settings.timezone), not the browser's. */
export const todayIn = (timeZone: string) => dayOf(Date.now(), timeZone);

/** The day `n` days after `day` (before it when `n` is negative). */
export const addDays = (day: string, n: number) => dayAtUtc(utcOf(day) + n * DAY_MS);

/** The first day of the week holding `day`, with the driver's week start (0 Sunday, 1 Monday). */
export const weekOf = (day: string, weekStart: number) =>
  addDays(day, -((new Date(utcOf(day)).getUTCDay() - weekStart + 7) % 7));

/** The instant `day` begins in `timeZone` (that instant reads back as the same day there). */
export function startOfDay(day: string, timeZone: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  let guess = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 3; i++) {
    const shown = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(new Date(guess))
      .reduce<Record<string, number>>((a, p) => ({ ...a, [p.type]: Number(p.value) }), {});
    const asUtc = Date.UTC(shown.year!, shown.month! - 1, shown.day!, shown.hour, shown.minute);
    guess -= asUtc - Date.UTC(y, m - 1, d);
  }
  return guess;
}

/** Two days, the first and the last, both included. */
export interface Range {
  from: string;
  to: string;
}
export type PeriodKind = 'week' | 'month' | 'year';

/** The whole week, month or year holding `day`, or the one `offset` periods away (< 0 is earlier). */
export function period(kind: PeriodKind, day: string, weekStart: number, offset = 0): Range {
  const [y, m] = day.split('-').map(Number) as [number, number];
  if (kind === 'week') {
    const from = addDays(weekOf(day, weekStart), offset * 7);
    return { from, to: addDays(from, 6) };
  }
  if (kind === 'month') {
    const from = dayAtUtc(Date.UTC(y, m - 1 + offset, 1));
    return { from, to: dayAtUtc(Date.UTC(y, m + offset, 0)) };
  }
  return { from: `${y + offset}-01-01`, to: `${y + offset}-12-31` };
}

/** How many periods from the one holding `today` to the one holding `day` (≤ 0 in the past). */
export function periodOffset(kind: PeriodKind, day: string, today: string, weekStart: number) {
  const [y, m] = day.split('-').map(Number) as [number, number];
  const [ty, tm] = today.split('-').map(Number) as [number, number];
  if (kind === 'year') return y - ty;
  if (kind === 'month') return (y - ty) * 12 + (m - tm);
  const weeks = utcOf(weekOf(day, weekStart)) - utcOf(weekOf(today, weekStart));
  return Math.round(weeks / (7 * DAY_MS));
}

/** The dashboard's period tabs, each from its first day up to today. */
export const PERIODS: {
  id: 'today' | 'week' | 'month' | 'year' | '30d';
  label: string;
  range: (today: string, weekStart: number) => Range;
}[] = [
  { id: '30d', label: '30 days', range: (today) => ({ from: addDays(today, -29), to: today }) },
  {
    id: 'month',
    label: 'Month',
    range: (today, ws) => ({ from: period('month', today, ws).from, to: today }),
  },
  { id: 'today', label: 'Today', range: (today) => ({ from: today, to: today }) },
  { id: 'week', label: 'Week', range: (today, ws) => ({ from: weekOf(today, ws), to: today }) },
  {
    id: 'year',
    label: 'Year',
    range: (today, ws) => ({ from: period('year', today, ws).from, to: today }),
  },
];

/** English with the driver's country, so the day, month and year come in that country's order. */
export function dateLocale(country: string): string {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf(`en-${country}`)[0] ?? 'en-CA';
  } catch {
    return 'en-CA';
  }
}

/** "Nov 7, 2026" (en-CA, en-US) or "7 Nov 2026" (en-GB); formatted in UTC on both sides. */
export function formatDay(iso: string, locale: string): string {
  const d = isoToDate(iso);
  if (!d) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()),
  );
}

/** A month (any day in it) in the driver's country's style: "Nov 2026". */
export function formatMonth(iso: string, locale: string): string {
  const d = isoToDate(iso);
  if (!d) return '';
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(d.getFullYear(), d.getMonth(), 1));
}

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' })
    .format(Date.UTC(2026, i, 1))
    .toLowerCase(),
);

/** Does the locale write the day before the month in numeric dates (7/11/2026)? */
const dayFirst = (locale: string) =>
  new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', timeZone: 'UTC' })
    .formatToParts(Date.UTC(2026, 10, 7))
    .find((p) => p.type === 'day' || p.type === 'month')?.type === 'day';

/**
 * A typed day to `YYYY-MM-DD`, or null. Accepts 2026-11-07, numbers in the locale's order with a
 * four-digit year (11/7/2026 or 7/11/2026), and a month name in any order (Nov 7, 2026; 7 November 2026).
 */
export function parseDay(text: string, locale: string): string | null {
  const parts = text
    .trim()
    .toLowerCase()
    .split(/[\s,./-]+/)
    .filter(Boolean);
  if (parts.length !== 3) return null;
  let y: number, m: number, d: number;
  const month = parts.findIndex((p) => /^[a-z]{3,}$/.test(p));
  if (month >= 0) {
    m = MONTHS.findIndex((name) => name.startsWith(parts[month]!)) + 1;
    const rest = parts.filter((_, i) => i !== month).map((p) => p.replace(/(st|nd|rd|th)$/, ''));
    const year = rest.findIndex((p) => /^\d{4}$/.test(p));
    const other = rest[1 - year];
    if (m === 0 || year < 0 || !other || !/^\d{1,2}$/.test(other)) return null;
    [y, d] = [Number(rest[year]), Number(other)];
  } else {
    if (!parts.every((p) => /^\d+$/.test(p))) return null;
    const [a, b, c] = parts.map(Number) as [number, number, number];
    if (parts[0]!.length === 4) [y, m, d] = [a, b, c];
    else if (parts[2]!.length === 4) [y, m, d] = dayFirst(locale) ? [c, b, a] : [c, a, b];
    else return null;
  }
  const date = day(y, m, d);
  return date ? dateToIso(date) : null;
}

/** A day as English words; the day is already the driver's, so it is formatted as UTC. */
export const dateWords = (day: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(utcOf(day));

/** "Nov 13 – 19, 2023", or "Oct 30 – Nov 5, 2023" when the week spans two months. */
export const weekWords = (from: string, to: string) => {
  const start = dateWords(from, { month: 'short', day: 'numeric' });
  const end =
    from.slice(0, 7) === to.slice(0, 7)
      ? String(Number(to.slice(8)))
      : dateWords(to, { month: 'short', day: 'numeric' });
  return `${start} – ${end}, ${to.slice(0, 4)}`;
};

/** "Nov 2 – 8, 2026" in the driver's country's order (Intl formatRange). */
export function rangeText(from: string, to: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).formatRange(
    utcOf(from),
    utcOf(to),
  );
}
