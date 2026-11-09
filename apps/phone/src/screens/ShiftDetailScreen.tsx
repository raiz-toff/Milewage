import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { ArrowRightLeft, Info } from 'lucide-react-native';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Separator } from '../components/ui/separator';
import { Skeleton } from '../components/ui/skeleton';
import { Text } from '../components/ui/text';
import { M_PER_UNIT, formatClock, formatDistance, totalsCaption } from '../format';
import type { ScreenProps } from '../navigation';
import { deriveFlags } from '../pairing/pairing';
import { useServices } from '../services';
import type { ConflictRow, ShiftRow, StopRow, TripRow } from '../store/shiftStore';
import { useColors } from '../theme/theme';
import { Field } from '../ui/Field';
import { useToast } from '../ui/Toast';
import { Rows } from '../ui/Parts';
import { Screen } from '../ui/Screen';
import { SyncBadge } from './marker';
import { RouteView } from './RouteView';

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

type EditFailure = 'no_shift' | 'finalized' | 'no_trip' | 'not_editable' | 'invalid';

const EDIT_PROBLEMS: Record<EditFailure, { title: string; description?: string }> = {
  finalized: {
    title: 'This shift is finalized on the server.',
    description: 'A finalized shift cannot be changed any more.',
  },
  no_shift: { title: 'This shift is no longer on this phone.' },
  no_trip: {
    title: 'That trip is no longer on this phone.',
    description: 'Pull to refresh Shifts.',
  },
  not_editable: { title: 'This cannot be changed.' },
  invalid: { title: 'That value is not valid.', description: 'Check the number and try again.' },
};

const NEXT = { active: 'deadhead', deadhead: 'personal', personal: 'active' } as const;
const KIND = { active: 'Active', deadhead: 'Deadhead', personal: 'Personal' } as const;

/** One shift from `app.db`: totals, the estimated split, trips and the route. No connection needed. */
export function ShiftDetailScreen({ route, navigation }: ScreenProps<'ShiftDetail'>) {
  const C = useColors();
  const { width } = useWindowDimensions();
  const { shifts, pairing, edits, sender } = useServices();
  const [distance, setDistance] = useState('');
  const [odo, setOdo] = useState('');
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [shift, setShift] = useState<ShiftRow | null>(null);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [diffs, setDiffs] = useState<ConflictRow[]>([]);
  const [unit, setUnit] = useState<'km' | 'mi'>('km');
  const [zone, setZone] = useState('UTC');
  const [stopsOn, setStopsOn] = useState(false);
  const [stops, setStops] = useState<StopRow[]>([]);

  useEffect(() => {
    void (async () => {
      const flags = deriveFlags((await pairing.load())?.settings ?? null);
      setUnit(flags.distanceUnit);
      setZone(flags.timezone);
      setStopsOn(flags.stops);
      setStops(await shifts.stops(route.params.clientId));
      setShift(await shifts.get(route.params.clientId));
      setTrips(await shifts.trips(route.params.clientId));
      setDiffs(await shifts.conflicts(route.params.clientId));
      setLoaded(true);
    })();
  }, [shifts, pairing, route.params.clientId]);

  const reload = async () => {
    setShift(await shifts.get(route.params.clientId));
    setTrips(await shifts.trips(route.params.clientId));
    void sender.sendNow();
  };
  /** One toast per edit: what happened, and why not when it did not. */
  const saved = (r: { ok: true } | { ok: false; reason: EditFailure }, what: string) => {
    if (r.ok) return toast.show({ tone: 'success', title: what });
    toast.show({ tone: 'error', ...EDIT_PROBLEMS[r.reason] });
  };
  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch {
      toast.show({ tone: 'error', title: 'This could not be saved.', description: 'Try again.' });
    }
  };
  /** Metres from a typed number, or null with a toast when it is not a positive number. */
  const metres = (text: string, what: string) => {
    const n = Number(text.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      toast.show({
        tone: 'error',
        title: `The ${what} must be a number above 0.`,
        description: `In ${unit === 'mi' ? 'miles' : 'kilometres'}, for example 12.5.`,
      });
      return null;
    }
    return Math.round(n * M_PER_UNIT[unit]);
  };

  if (!shift) {
    return (
      <Screen title="Shift">
        {!loaded ? (
          <View className="gap-3">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </View>
        ) : (
          <Card className="items-center py-10">
            <CardHeader className="items-center">
              <CardTitle>This shift is no longer on this phone.</CardTitle>
              <CardDescription className="text-center">
                It may have been deleted on the server. Your other shifts are in the list.
              </CardDescription>
            </CardHeader>
            <Button variant="outline" onPress={() => navigation.navigate('Shifts')}>
              <Text>Back to shifts</Text>
            </Button>
          </Card>
        )}
      </Screen>
    );
  }
  const editable = shift.status === 'ended';
  // Stops and the estimated split follow the server's `stops_enabled` and the shift's own segmenter:
  // with the setting off, or for a shift recorded without stops, only the one total is shown.
  const estimated = stopsOn && shift.segmenter === 'stops';
  const date = new Date(`${shift.local_date}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return (
    <Screen
      title={date}
      description={`${formatClock(shift.started_at, zone)}${shift.ended_at !== null ? ` to ${formatClock(shift.ended_at, zone)}` : ''} · ${shift.local_date}`}
    >
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
          <Alert icon={Info}>
            <AlertDescription>{describe(d, unit)}</AlertDescription>
          </Alert>
        </Pressable>
      ))}

      <Card className="overflow-hidden pt-0">
        <RouteView geojson={shift.route_geojson} width={Math.max(200, width - 34)} height={200} />
        <CardHeader className="flex-row items-start justify-between pt-0">
          <View className="flex-1 gap-1">
            <CardDescription>Total distance</CardDescription>
            <CardTitle
              tabular
              accessibilityLabel="Total"
              className="font-sans-semibold text-3xl tracking-tight"
            >
              {shift.total_m === null ? '-' : formatDistance(shift.total_m, unit)}
            </CardTitle>
            <Text variant="muted">
              {shift.status === 'active' ? 'In progress' : totalsCaption(shift)}
            </Text>
          </View>
          <SyncBadge shift={shift} />
        </CardHeader>
        {estimated &&
          shift.total_m !== null &&
          shift.active_m !== null &&
          shift.deadhead_m !== null && (
            <CardContent>
              <Separator />
              <Text variant="label" tabular className="text-muted-foreground">
                Active {formatDistance(shift.active_m, unit)} · Deadhead{' '}
                {formatDistance(shift.deadhead_m, unit)} (estimated)
              </Text>
            </CardContent>
          )}
      </Card>

      {estimated && (
        <ListCard title="Stops (estimated, labelled on the web)">
          {stops.length === 0
            ? [<Line key="none" text="No stops detected." muted />]
            : stops.map((st) => (
                <Line
                  key={st.stop_key}
                  muted={st.confidence === 'low'}
                  text={`${formatClock(st.started_at, zone)} · ${Math.round(st.dwell_s / 60)} min · ${st.confidence} confidence${st.est_role !== 'none' ? ` · looks like a ${st.est_role}` : ''}`}
                />
              ))}
        </ListCard>
      )}

      <ListCard title="Trips">
        {trips.length === 0
          ? [<Line key="none" text="No trips." muted />]
          : trips.map((t) => (
              <View key={t.trip_key} className="min-h-[56px] flex-row items-center gap-2 px-4 py-2">
                <Text variant="label" tabular className="flex-1">
                  {formatClock(t.started_at, zone)}{' '}
                  {estimated || t.kind === 'personal' || t.source === 'manual'
                    ? `${KIND[t.kind]} `
                    : ''}
                  {formatDistance(t.distance_m, unit)}
                  {estimated && t.source === 'auto' ? ' (estimated)' : ''}
                  {t.source === 'manual' ? ' (added by you)' : ''}
                </Text>
                {editable && (
                  <Button
                    variant="outline"
                    size="sm"
                    accessibilityLabel={`Change type of trip at ${formatClock(t.started_at, zone)}`}
                    onPress={() =>
                      void run(async () => {
                        saved(
                          await edits.editTrip(t.trip_key, { kind: NEXT[t.kind] }),
                          `Trip changed to ${KIND[NEXT[t.kind]]}.`,
                        );
                        await reload();
                      })
                    }
                  >
                    <ArrowRightLeft size={14} color={C.foreground} />
                    <Text>{`${formatClock(t.started_at, zone)}: change to ${KIND[NEXT[t.kind]]}`}</Text>
                  </Button>
                )}
              </View>
            ))}
      </ListCard>

      {editable && (
        <Card>
          <CardHeader>
            <CardTitle>Corrections</CardTitle>
            <CardDescription>Add a trip the phone missed, or the end odometer.</CardDescription>
          </CardHeader>
          <CardContent>
            <Field
              label="Add a trip"
              accessibilityLabel="Trip distance"
              placeholder={`Distance (${unit})`}
              keyboardType="decimal-pad"
              value={distance}
              onChangeText={setDistance}
            />
            <Button
              variant="outline"
              disabled={distance.trim() === ''}
              onPress={() =>
                void run(async () => {
                  const m = metres(distance, 'distance');
                  if (m === null) return;
                  saved(
                    await edits.addManualTrip(shift.client_id, {
                      kind: 'active',
                      startedAt: shift.ended_at ?? shift.started_at,
                      endedAt: shift.ended_at ?? shift.started_at,
                      distanceM: m,
                    }),
                    'Trip added.',
                  );
                  setDistance('');
                  await reload();
                })
              }
            >
              <Text>Add trip</Text>
            </Button>
            <Separator />
            <Field
              label="End odometer"
              accessibilityLabel="End odometer"
              placeholder={`Reading (${unit})`}
              keyboardType="decimal-pad"
              value={odo}
              onChangeText={setOdo}
            />
            <Button
              variant="outline"
              disabled={odo.trim() === ''}
              onPress={() =>
                void run(async () => {
                  const m = metres(odo, 'reading');
                  if (m === null) return;
                  saved(
                    await edits.setOdometer(shift.client_id, 'shift_end', m),
                    'End odometer saved.',
                  );
                  setOdo('');
                  await reload();
                })
              }
            >
              <Text>Save end odometer</Text>
            </Button>
          </CardContent>
        </Card>
      )}
    </Screen>
  );
}

/** A card holding a titled list of rows. */
function ListCard({ title, children }: { title: string; children: ReactNode[] }) {
  return (
    <Card className="pb-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <View className="border-t border-border">
        <Rows>{children}</Rows>
      </View>
    </Card>
  );
}

function Line({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <View className="min-h-[48px] justify-center px-4 py-3">
      <Text variant="label" tabular className={muted ? 'text-muted-foreground' : ''}>
        {text}
      </Text>
    </View>
  );
}
