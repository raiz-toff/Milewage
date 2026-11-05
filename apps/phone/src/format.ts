export const M_PER_UNIT = { km: 1000, mi: 1609.344 } as const;
export type DistanceUnit = keyof typeof M_PER_UNIT;

/** Whole metres as "12.3 km" or "7.6 mi". */
export function formatDistance(m: number, unit: DistanceUnit): string {
  return `${(m / M_PER_UNIT[unit]).toFixed(1)} ${unit}`;
}

/** "HH:MM" of an instant in an IANA zone (the instance's, never the device's). */
export function formatClock(at: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(at);
  } catch {
    return new Date(at).toISOString().slice(11, 16);
  }
}

/** The "who calculated this" line under a shift's total (15 section 4.2). */
export function totalsCaption(s: {
  total_m: number | null;
  calc_source: 'phone' | 'server';
}): string {
  if (s.total_m === null) return 'Totals will appear after sync';
  return s.calc_source === 'server' ? 'Confirmed by server' : 'Calculated on phone';
}
