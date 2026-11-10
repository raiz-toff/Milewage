export type TimeFormat = '12h' | '24h';

const LOCALE = 'en-CA';

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

/**
 * The driver's distance unit (Settings > Distance unit). The server stores every distance in whole
 * metres (fields end in `_m`); these helpers are the only place that converts.
 */
export type DistanceUnit = 'km' | 'mi';

const metresPer = (unit: DistanceUnit) => (unit === 'km' ? 1000 : 1609.344);

/** A distance in the driver's unit to whole metres. */
export const toMetres = (value: number, unit: DistanceUnit): number =>
  Math.round(value * metresPer(unit));

/** Metres as a number in the driver's unit, unrounded: the inverse of `toMetres`. */
export const fromMetres = (m: number, unit: DistanceUnit): number => m / metresPer(unit);

/** Metres in the driver's unit with one decimal; null (not computed yet) is a dash, never 0. */
export function formatDistance(m: number | null, unit: DistanceUnit): string {
  if (m === null) return '—';
  return `${fromMetres(m, unit).toFixed(1)} ${unit}`;
}

/** An odometer value as the driver reads it on the dial: whole units, grouped ("12,346 mi"). */
export const formatOdometer = (m: number, unit: DistanceUnit): string =>
  `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(Math.round(fromMetres(m, unit)))} ${unit}`;

/** Metres as the plain number a form field shows ("12480.5"), to `places` decimals at most. */
export const distanceInput = (m: number, unit: DistanceUnit, places = 1): string =>
  String(Math.round(fromMetres(m, unit) * 10 ** places) / 10 ** places);

/**
 * A distance typed by the driver ("12,480.5": thousands commas are allowed) to whole metres; null
 * when it is blank, negative or not a number.
 */
export function parseDistance(text: string, unit: DistanceUnit): number | null {
  const t = text.trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return toMetres(Number(t), unit);
}

export function formatDuration(startMs: number, endMs: number | null): string {
  if (endMs === null) return 'in progress';
  const mins = Math.max(0, Math.round((endMs - startMs) / 60000));
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

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

/**
 * A per-distance rate in minor units with hundredths (72.5 cents) in the instance currency, with
 * the two extra digits a rate can have: "$0.725".
 */
export function formatRate(minor: number, currency: string): string {
  const digits = minorDigits(currency);
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      maximumFractionDigits: digits + 2,
    }).format(minor / scale(currency));
  } catch {
    return String(minor / scale(currency));
  }
}

/**
 * A deduction at the driver's own rate is always called theirs, never official (plan 21 Q5). The
 * rate is the figure's own when it says (`deduction_rate` of a shift or a period, ADR 0007), else
 * today's (`mileage_rate` of the settings).
 */
export function deductionWord(
  s: { mileage_rate?: string; deduction_rate?: string | null },
  start = false,
) {
  const rate = s.deduction_rate !== undefined ? s.deduction_rate : s.mileage_rate;
  const word =
    rate === 'yours'
      ? 'deduction (your rate)'
      : rate === 'mixed'
        ? 'deduction (country and your rate)'
        : 'deduction';
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
