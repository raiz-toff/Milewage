import { useEffect, useState } from 'react';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { useSession } from '../session';

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

/** Trips of one shift, time ordered; read again when `reloadKey` changes (a recompute). */
export function useShiftTrips(shiftId: number, reloadKey: number) {
  const { api } = useSession();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shiftId) return;
    let live = true;
    void unwrap(api.GET('/shifts/{ref}/trips', { params: { path: { ref: String(shiftId) } } }))
      .then((t) => live && setTrips(t))
      .catch((e) => live && setError(describe(e)));
    return () => {
      live = false;
    };
  }, [api, shiftId, reloadKey]);
  return { trips, error };
}
