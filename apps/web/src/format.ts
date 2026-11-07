/** Date and time in the instance time zone (settings.timezone), never the browser's. */
export function formatDateTime(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false,
  }).format(new Date(ms));
}

export function formatTime(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    timeStyle: 'short',
    hour12: false,
  }).format(new Date(ms));
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

/** Whole cents in the instance currency; null means the figure is not available. */
export function formatMoney(cents: number | null, currency: string): string {
  if (cents === null) return 'not available';
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(cents / 100);
}

/** Money typed by the driver to whole minor units; blank is 0, anything else invalid is NaN. */
export const toCents = (text: string): number =>
  text.trim() === '' ? 0 : Math.round(Number(text.replace(',', '.')) * 100);
