export type TimeFormat = '12h' | '24h';

/** Date and time in the instance time zone (settings.timezone), never the browser's. */
export function formatDateTime(
  ms: number,
  timeZone: string,
  timeFormat: TimeFormat = '24h',
): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: timeFormat === '12h',
  }).format(new Date(ms));
}

/** Clock time in the instance time zone; 12h or 24h follows Settings > Time format, not the browser. */
export function formatTime(ms: number, timeZone: string, timeFormat: TimeFormat = '24h'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    timeStyle: 'short',
    hour12: timeFormat === '12h',
  }).format(new Date(ms));
}

/** A stored "HH:MM" as the driver reads it: "17:05", or "5:05 PM" with the 12h setting. */
export function formatClock(hhmm: string, timeFormat: TimeFormat): string {
  if (timeFormat === '24h') return hhmm;
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const M_PER_MILE = 1609.344;

/** Metres in the driver's unit with one decimal; null (not computed yet) is a dash, never 0. */
export function formatDistance(m: number | null, unit: 'km' | 'mi'): string {
  if (m === null) return '—';
  const v = unit === 'km' ? m / 1000 : m / M_PER_MILE;
  return `${v.toFixed(1)} ${unit}`;
}

export function formatDuration(startMs: number, endMs: number | null): string {
  if (endMs === null) return 'in progress';
  const mins = Math.max(0, Math.round((endMs - startMs) / 60000));
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

const LOCALE = 'en-CA';

/**
 * Digits after the decimal point in a currency's minor unit: JPY 0, USD 2, KWD 3. The server stores
 * every amount as integer minor units of `settings.currency` (its fields are named `*_cents`).
 */
export function minorDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat(LOCALE, { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2; // not a currency code Intl knows
  }
}

const scale = (currency: string) => 10 ** minorDigits(currency);

/** Whole minor units in the instance currency; null means the figure is not available. */
export function formatMoney(minor: number | null, currency: string): string {
  if (minor === null) return 'not available';
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency }).format(
    minor / scale(currency),
  );
}

/** Minor units as the plain number a form field shows ("12.50", "1250", "1.250"). */
export const moneyInput = (minor: number, currency: string): string =>
  (minor / scale(currency)).toFixed(minorDigits(currency));

/** A deduction at the driver's own rate is always called theirs, never official (plan 21 Q5). */
export function deductionWord(s: { mileage_rate: string }, start = false) {
  const word = s.mileage_rate === 'yours' ? 'deduction (your rate)' : 'deduction';
  return start ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

/** Money typed by the driver to whole minor units; blank is 0, anything else invalid is NaN. */
export const parseMoney = (text: string, currency: string): number =>
  text.trim() === '' ? 0 : Math.round(Number(text.replace(',', '.')) * scale(currency));

/** A per-distance rate typed in major units to minor units; hundredths of a minor unit are kept. */
export const parseRate = (text: string, currency: string): number =>
  Math.round(Number(text) * scale(currency) * 100) / 100;

/** The stored per-distance rate as the number a form field shows. */
export const rateInput = (minor: number, currency: string): string =>
  String(Math.round((minor / scale(currency)) * 1e6) / 1e6);
