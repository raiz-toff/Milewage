// A calendar day is a `YYYY-MM-DD` string in the driver's time zone. These helpers never parse that
// string with `new Date(text)` (which reads it as UTC midnight and can land on the day before).

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

/** Today in the driver's time zone (settings.timezone), not the browser's. */
export const todayIn = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(Date.now());

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
