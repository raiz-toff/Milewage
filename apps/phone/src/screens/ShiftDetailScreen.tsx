import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { formatClock, formatDistance, totalsCaption } from '../format';
import type { ScreenProps } from '../navigation';
import { deriveFlags } from '../pairing/pairing';
import { useServices } from '../services';
import type { ShiftRow, TripRow } from '../store/shiftStore';
import { useTheme } from '../theme/theme';
import { RouteView } from './RouteView';
import { Screen } from './Screen';

const KIND = { active: 'Active', deadhead: 'Deadhead', personal: 'Personal' } as const;

/** One shift from `app.db`: totals, the estimated split, trips and the route. No connection needed. */
export function ShiftDetailScreen({ route }: ScreenProps<'ShiftDetail'>) {
  const theme = useTheme();
  const { shifts, pairing } = useServices();
  const [shift, setShift] = useState<ShiftRow | null>(null);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [unit, setUnit] = useState<'km' | 'mi'>('km');
  const [zone, setZone] = useState('UTC');

  useEffect(() => {
    void (async () => {
      const flags = deriveFlags((await pairing.load())?.settings ?? null);
      setUnit(flags.distanceUnit);
      setZone(flags.timezone);
      setShift(await shifts.get(route.params.clientId));
      setTrips(await shifts.trips(route.params.clientId));
    })();
  }, [shifts, pairing, route.params.clientId]);

  if (!shift) return <Screen title="Shift" />;
  const muted = { color: theme.textMuted };
  const estimated = shift.segmenter === 'stops';
  return (
    <Screen title={shift.local_date}>
      <ScrollView>
        <Text accessibilityLabel="Total" style={{ color: theme.text, fontSize: 36 }}>
          {shift.total_m === null ? '-' : formatDistance(shift.total_m, unit)}
        </Text>
        <Text style={muted}>
          {shift.status === 'active' ? 'In progress' : totalsCaption(shift)}
        </Text>
        {shift.total_m !== null && shift.active_m !== null && shift.deadhead_m !== null && (
          <Text style={{ color: theme.text, marginTop: 8 }}>
            Active {formatDistance(shift.active_m, unit)} · Deadhead{' '}
            {formatDistance(shift.deadhead_m, unit)}
            {estimated ? ' (estimated)' : ''}
          </Text>
        )}
        <Text style={{ ...muted, marginTop: 4 }}>
          {formatClock(shift.started_at, zone)}
          {shift.ended_at !== null ? ` to ${formatClock(shift.ended_at, zone)}` : ''}
        </Text>
        <RouteView geojson={shift.route_geojson} width={320} height={220} />
        <Text style={{ ...muted, marginTop: 12 }}>Trips</Text>
        {trips.length === 0 && <Text style={muted}>No trips.</Text>}
        {trips.map((t) => (
          <Text key={t.trip_key} style={{ color: theme.text, paddingVertical: 4 }}>
            {formatClock(t.started_at, zone)} {KIND[t.kind]} {formatDistance(t.distance_m, unit)}
            {estimated && t.source === 'auto' ? ' (estimated)' : ''}
          </Text>
        ))}
      </ScrollView>
    </Screen>
  );
}
