/** The calendar date (`YYYY-MM-DD`) of an instant in an IANA time zone. Dates are never derived any other way (07 section 1). */
export const localDate = (at: number, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);

/** A local date `YYYY-MM-DD` one recurrence step later; a month end stays a month end (Jan 31 -> Feb 28). */
export function addInterval(date: string, step: 'weekly' | 'monthly' | 'yearly'): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  if (step === 'weekly') return new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
  const months = step === 'monthly' ? 1 : 12;
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}
