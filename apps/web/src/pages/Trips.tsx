import { describe } from '../api/client';
import type { Schemas } from '../api/client';
import { useApiQuery } from '../api/query';

type Trip = Schemas['Trip'];

/**
 * What a trip's kind reads as, and whether it is an estimate. With the split off (stops module
 * or setting off, or a shift that was not segmented by stops) active and deadhead are one thing:
 * business. Only the engine's own (auto) active and deadhead are estimates.
 */
export function kindOf(trip: Trip, split: boolean): { text: string; estimated: boolean } {
  if (trip.kind === 'personal') return { text: 'personal', estimated: false };
  if (!split) return { text: 'business', estimated: false };
  return { text: trip.kind, estimated: trip.source === 'auto' };
}

/** Trips of one shift, time ordered; a recompute of the shift has them read again. */
export function useShiftTrips(shiftId: number) {
  const q = useApiQuery(
    '/shifts/{ref}/trips',
    { params: { path: { ref: String(shiftId) } } },
    { enabled: !!shiftId },
  );
  return { trips: q.data ?? null, error: q.error ? describe(q.error) : null };
}
