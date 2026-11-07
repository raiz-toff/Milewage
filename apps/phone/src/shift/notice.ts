import { formatClock } from '../format';
import { localDate, type ShiftRow } from '../store/shiftStore';
import type { ShiftNotice } from '../tracker/types';

type Row = Pick<ShiftRow, 'client_id' | 'local_date' | 'status' | 'total_m'>;

/**
 * What the running-shift notification says around the distance: today's shifts that already
 * ended (by the instance's local date of the shift's start), and a footer with the start time and
 * vehicle. The tracker adds the live distance and the clock.
 */
export function shiftNotice(a: {
  clientId: string;
  startedAt: number;
  vehicle: string | null;
  rows: readonly Row[];
  unit: 'km' | 'mi';
  timeZone: string;
}): ShiftNotice {
  const day = localDate(a.startedAt, a.timeZone);
  const earlier = a.rows.filter(
    (r) =>
      r.client_id !== a.clientId &&
      r.local_date === day &&
      r.status !== 'active' &&
      r.total_m !== null,
  );
  const started = `Started ${formatClock(a.startedAt, a.timeZone)}`;
  return {
    startedAt: a.startedAt,
    unit: a.unit,
    earlierM: earlier.reduce((m, r) => m + r.total_m!, 0),
    earlierShifts: earlier.length,
    footer: a.vehicle ? `${started} · ${a.vehicle}` : started,
  };
}
