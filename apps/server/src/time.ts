const DAY = 24 * 60 * 60 * 1000;

/** The calendar date (`YYYY-MM-DD`) of an instant in an IANA time zone. Dates are never derived any other way (07 section 1). */
export const localDate = (at: number, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);

const wallClocks = new Map<string, Intl.DateTimeFormat>();
/** The zone's offset from UTC at an instant, in milliseconds (positive east of Greenwich). */
function offsetAt(at: number, timeZone: string): number {
  let f = wallClocks.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    wallClocks.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, Number(x.value)]));
  const wall = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return wall - (at - (at % 1000));
}

/**
 * The instant of a local wall-clock time: a date `YYYY-MM-DD` and a minute of that day, in an IANA
 * time zone. This is the only conversion from local time to an instant on the server.
 * Daylight-saving changes follow RFC 5545 (Temporal calls it `compatible`): a time that occurs twice
 * (the clocks go back) is the first of the two; a time that does not occur (the clocks go forward) is
 * read with the offset in force before the change, so 02:30 on a spring-forward night is 03:30.
 */
export function localInstant(date: string, minutes: number, timeZone: string): number {
  const wall = Date.parse(`${date}T00:00:00Z`) + minutes * 60_000;
  const before = offsetAt(wall - DAY, timeZone);
  const after = offsetAt(wall + DAY, timeZone);
  const fits = [before, after]
    .map((offset) => ({ offset, at: wall - offset }))
    .filter((c) => offsetAt(c.at, timeZone) === c.offset)
    .map((c) => c.at);
  return fits.length ? Math.min(...fits) : wall - before;
}

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
