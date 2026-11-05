import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput } from 'react-native';
import { M_PER_UNIT, formatClock, formatDistance, totalsCaption } from '../format';
import type { ScreenProps } from '../navigation';
import { deriveFlags } from '../pairing/pairing';
import { useServices } from '../services';
import type { ConflictRow, ShiftRow, TripRow } from '../store/shiftStore';
import { useTheme } from '../theme/theme';
import { RouteView } from './RouteView';
import { Screen } from './Screen';

/** The driver-visible sentence for a change the server made (15 section 7.4). */
export function describe(d: ConflictRow, unit: 'km' | 'mi'): string {
  const local = JSON.parse(d.local_json) as Record<string, unknown>;
  const server = d.server_json ? (JSON.parse(d.server_json) as Record<string, unknown>) : null;
  if (
    d.reason === 'recon_diff' &&
    typeof local.total_m === 'number' &&
    typeof server?.total_m === 'number'
  ) {
    const diff = Math.abs(local.total_m - server.total_m);
    const why =
      Array.isArray(server.reasons) && server.reasons.length > 0
        ? ` Reason: ${server.reasons.join(', ')}.`
        : '';
    return `Server confirmed ${formatDistance(server.total_m, unit)}. Your phone showed ${formatDistance(local.total_m, unit)} (${formatDistance(diff, unit)} difference).${why} Tap to dismiss.`;
  }
  if (d.reason === 'deleted_on_server')
    return 'This was deleted on the server; your unsent change was not sent. Tap to dismiss.';
  if (server?.orphaned) return 'One of your edits could not be applied. Tap to dismiss.';
  return 'A change on the server replaced your unsent edit. Tap to dismiss.';
}

const NEXT = { active: 'deadhead', deadhead: 'personal', personal: 'active' } as const;
const KIND = { active: 'Active', deadhead: 'Deadhead', personal: 'Personal' } as const;

/** One shift from `app.db`: totals, the estimated split, trips and the route. No connection needed. */
export function ShiftDetailScreen({ route }: ScreenProps<'ShiftDetail'>) {
  const theme = useTheme();
  const { shifts, pairing, edits, shift: controller } = useServices();
  const [distance, setDistance] = useState('');
  const [odo, setOdo] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [shift, setShift] = useState<ShiftRow | null>(null);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [diffs, setDiffs] = useState<ConflictRow[]>([]);
  const [unit, setUnit] = useState<'km' | 'mi'>('km');
  const [zone, setZone] = useState('UTC');

  useEffect(() => {
    void (async () => {
      const flags = deriveFlags((await pairing.load())?.settings ?? null);
      setUnit(flags.distanceUnit);
      setZone(flags.timezone);
      setShift(await shifts.get(route.params.clientId));
      setTrips(await shifts.trips(route.params.clientId));
      setDiffs(await shifts.conflicts(route.params.clientId));
    })();
  }, [shifts, pairing, route.params.clientId]);

  const reload = async () => {
    setShift(await shifts.get(route.params.clientId));
    setTrips(await shifts.trips(route.params.clientId));
    void controller.sync();
  };
  const fail = (r: { ok: boolean }) => setNote(r.ok ? null : 'This could not be saved.');

  if (!shift) return <Screen title="Shift" />;
  const editable = shift.status === 'ended';
  const muted = { color: theme.textMuted };
  const estimated = shift.segmenter === 'stops';
  return (
    <Screen title={shift.local_date}>
      <ScrollView>
        {diffs.map((d) => (
          <Pressable
            key={d.id}
            accessibilityRole="button"
            accessibilityLabel="Dismiss change notice"
            onPress={async () => {
              await shifts.markSeen(d.id);
              setDiffs((all) => all.filter((x) => x.id !== d.id));
            }}
          >
            <Text style={{ color: theme.text, marginBottom: 8 }}>{describe(d, unit)}</Text>
          </Pressable>
        ))}
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
            {t.source === 'manual' ? ' (added by you)' : ''}
          </Text>
        ))}
        {editable &&
          trips.map((t) => (
            <Pressable
              key={`edit-${t.trip_key}`}
              accessibilityRole="button"
              accessibilityLabel={`Change type of trip at ${formatClock(t.started_at, zone)}`}
              onPress={async () => {
                fail(await edits.editTrip(t.trip_key, { kind: NEXT[t.kind] }));
                await reload();
              }}
            >
              <Text style={{ color: theme.accent, paddingVertical: 4 }}>
                {formatClock(t.started_at, zone)}: change to {KIND[NEXT[t.kind]]}
              </Text>
            </Pressable>
          ))}
        {editable && (
          <>
            <TextInput
              accessibilityLabel="Trip distance"
              placeholder={`Add a trip (${unit})`}
              placeholderTextColor={theme.textMuted}
              keyboardType="decimal-pad"
              value={distance}
              onChangeText={setDistance}
              style={{
                color: theme.text,
                borderColor: theme.border,
                borderWidth: 1,
                padding: 8,
                marginTop: 8,
              }}
            />
            <Pressable
              accessibilityRole="button"
              onPress={async () => {
                const m = Math.round(Number(distance.replace(',', '.')) * M_PER_UNIT[unit]);
                fail(
                  await edits.addManualTrip(shift.client_id, {
                    kind: 'active',
                    startedAt: shift.ended_at ?? shift.started_at,
                    endedAt: shift.ended_at ?? shift.started_at,
                    distanceM: m,
                    purpose: '',
                  }),
                );
                setDistance('');
                await reload();
              }}
            >
              <Text style={{ color: theme.accent, paddingVertical: 4 }}>Add trip</Text>
            </Pressable>
            <TextInput
              accessibilityLabel="End odometer"
              placeholder={`End odometer (${unit})`}
              placeholderTextColor={theme.textMuted}
              keyboardType="decimal-pad"
              value={odo}
              onChangeText={setOdo}
              style={{
                color: theme.text,
                borderColor: theme.border,
                borderWidth: 1,
                padding: 8,
                marginTop: 8,
              }}
            />
            <Pressable
              accessibilityRole="button"
              onPress={async () => {
                fail(
                  await edits.setOdometer(
                    shift.client_id,
                    'shift_end',
                    Number(odo.replace(',', '.')) * M_PER_UNIT[unit],
                  ),
                );
                setOdo('');
                await reload();
              }}
            >
              <Text style={{ color: theme.accent, paddingVertical: 4 }}>Save end odometer</Text>
            </Pressable>
          </>
        )}
        {note && (
          <Text accessibilityRole="alert" style={{ color: theme.text }}>
            {note}
          </Text>
        )}
      </ScrollView>
    </Screen>
  );
}
