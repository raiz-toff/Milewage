import { useEffect, useState } from 'react';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { formatDistance, formatTime } from '../format';
import { useSession, useSettings } from '../session';
import { SortTable } from '../ui/SortTable';
import type { Column } from '../ui/SortTable';

type Trip = Schemas['Trip'];
type Shift = Schemas['Shift'];

/**
 * What a trip's kind reads as. With the split off (stops module or setting off, or a shift that
 * was not segmented by stops) active and deadhead are one thing: business.
 */
export function kindLabel(trip: Trip, split: boolean): string {
  if (trip.kind === 'personal') return 'personal';
  if (!split) return 'business';
  return trip.source === 'auto' ? `${trip.kind} (estimated)` : trip.kind;
}

/** Trips of one shift, time ordered, with the kind marked as an estimate where it is one. */
export function TripsTable({
  shift,
  split,
  reloadKey,
}: {
  shift: Shift;
  split: boolean;
  /** Changes when something recomputed the shift (a stop label), so trips are read again. */
  reloadKey: number;
}) {
  const { api } = useSession();
  const settings = useSettings();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void unwrap(api.GET('/shifts/{ref}/trips', { params: { path: { ref: String(shift.id) } } }))
      .then((t) => live && setTrips(t))
      .catch((e) => live && setError(describe(e)));
    return () => {
      live = false;
    };
  }, [api, shift.id, reloadKey]);

  if (error) return <p className="text-muted-foreground">Trips could not be loaded. {error}</p>;
  if (trips === null) return <p className="text-muted-foreground">Loading trips</p>;
  if (trips.length === 0) return <p className="text-muted-foreground">No trips were recorded.</p>;

  const tz = settings.timezone;
  const unit = settings.distance_unit;
  const columns: Column<Trip>[] = [
    {
      key: 'start',
      label: 'Start',
      sortValue: (t) => t.started_at,
      render: (t) => formatTime(t.started_at, tz),
    },
    {
      key: 'end',
      label: 'End',
      sortValue: (t) => t.ended_at,
      render: (t) => formatTime(t.ended_at, tz),
    },
    {
      key: 'distance',
      label: 'Distance',
      numeric: true,
      sortValue: (t) => t.distance_m,
      text: (t) => formatDistance(t.distance_m, unit),
      render: (t) => formatDistance(t.distance_m, unit),
    },
    {
      key: 'kind',
      label: 'Kind',
      sortValue: (t) => kindLabel(t, split),
      text: (t) => kindLabel(t, split),
      render: (t) => kindLabel(t, split),
    },
    {
      key: 'purpose',
      label: 'Purpose',
      sortValue: (t) => (t.purpose === '' ? null : t.purpose),
      text: (t) => t.purpose,
      render: (t) => t.purpose || '—',
    },
    { key: 'source', label: 'Source', sortValue: (t) => t.source, render: (t) => t.source },
  ];
  return (
    <SortTable
      caption="Trips"
      columns={columns}
      rows={trips}
      rowKey={(t) => t.id}
      initialSort={{ key: 'start', dir: 'asc' }}
    />
  );
}
