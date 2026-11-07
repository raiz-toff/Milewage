import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ChevronRight, Route } from 'lucide-react-native';
import { Button } from '../components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { Text } from '../components/ui/text';
import { formatClock, formatDistance, totalsCaption } from '../format';
import type { ScreenProps } from '../navigation';
import { deriveFlags } from '../pairing/pairing';
import { useServices } from '../services';
import type { ShiftRow } from '../store/shiftStore';
import { markerFor } from '../sync/status';
import { useColors } from '../theme/theme';
import { Dot, ListRow, Rows } from '../ui/Parts';
import { Screen } from '../ui/Screen';
import { useToast } from '../ui/Toast';

/** Every shift this phone has, newest first. Works with no connection: it reads `app.db`. */
export function ShiftsScreen({ navigation }: ScreenProps<'Shifts'>) {
  const C = useColors();
  const { shifts, pairing, shift: controller } = useServices();
  const [rows, setRows] = useState<ShiftRow[] | null>(null);
  const [unit, setUnit] = useState<'km' | 'mi'>('km');
  const [zone, setZone] = useState('UTC');
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const flags = deriveFlags((await pairing.load())?.settings ?? null);
      setUnit(flags.distanceUnit);
      setZone(flags.timezone);
      setRows(await shifts.list());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [shifts, pairing]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const refresh = async () => {
    setRefreshing(true);
    try {
      await controller.sync();
    } catch {
      toast.show({
        title: 'Could not reach the server.',
        description: 'The list shows what is on this phone; it syncs again by itself.',
      });
    } finally {
      await load();
      setRefreshing(false);
    }
  };

  return (
    <Screen
      title="Shifts"
      description="Every shift on this phone, newest first. Pull down to sync."
      onRefresh={() => void refresh()}
      refreshing={refreshing}
    >
      {rows === null && !failed && <Skeleton className="h-64 rounded-xl" />}
      {failed && (
        <Card className="items-center py-10">
          <CardHeader className="items-center">
            <CardTitle>Your shifts could not be read.</CardTitle>
            <CardDescription className="text-center">
              They are still on this phone. Try again; restarting the app also helps.
            </CardDescription>
          </CardHeader>
          <Button variant="outline" onPress={() => void load()}>
            <Text>Try again</Text>
          </Button>
        </Card>
      )}
      {rows?.length === 0 && (
        <Card className="items-center py-10">
          <View className="h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Route size={22} color={C.mutedForeground} />
          </View>
          <CardHeader className="items-center">
            <CardTitle>No shifts yet.</CardTitle>
            <CardDescription className="text-center">
              Start a shift on the home screen. Every shift is kept here, even with no connection.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      {rows && rows.length > 0 && (
        <Card className="py-0">
          <Rows>
            {rows.map((s) => {
              const active = s.status === 'active';
              return (
                <ListRow
                  key={s.client_id}
                  accessibilityLabel={`Shift ${s.local_date}`}
                  onPress={() => navigation.navigate('ShiftDetail', { clientId: s.client_id })}
                >
                  <View className="flex-1 gap-1.5">
                    <View className="flex-row items-center gap-2">
                      {active && <Dot color={C.signal} size={7} pulse />}
                      <Text variant="label">{s.local_date}</Text>
                      <Text variant="muted" tabular>
                        {formatClock(s.started_at, zone)}
                      </Text>
                    </View>
                    <Text variant="muted" numberOfLines={2}>
                      {active ? 'In progress' : totalsCaption(s)} · {markerFor(s).label}
                    </Text>
                  </View>
                  <Text variant="label" tabular className="text-base">
                    {s.total_m === null ? '-' : formatDistance(s.total_m, unit)}
                  </Text>
                  <ChevronRight size={16} color={C.mutedForeground} />
                </ListRow>
              );
            })}
          </Rows>
        </Card>
      )}
    </Screen>
  );
}
