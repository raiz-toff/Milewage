import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import { formatDistance, totalsCaption } from '../format';
import type { ScreenProps } from '../navigation';
import { deriveFlags } from '../pairing/pairing';
import { useServices } from '../services';
import type { ShiftRow } from '../store/shiftStore';
import { useTheme } from '../theme/theme';
import { Screen } from './Screen';

/** Every shift this phone has, newest first. Works with no connection: it reads `app.db`. */
export function ShiftsScreen({ navigation }: ScreenProps<'Shifts'>) {
  const theme = useTheme();
  const { shifts, pairing } = useServices();
  const [rows, setRows] = useState<ShiftRow[] | null>(null);
  const [unit, setUnit] = useState<'km' | 'mi'>('km');

  useEffect(() => {
    void (async () => {
      setUnit(deriveFlags((await pairing.load())?.settings ?? null).distanceUnit);
      setRows(await shifts.list());
    })();
  }, [shifts, pairing]);

  return (
    <Screen title="Shifts">
      <ScrollView>
        {rows?.length === 0 && <Text style={{ color: theme.textMuted }}>No shifts yet.</Text>}
        {rows?.map((s) => (
          <Pressable
            key={s.client_id}
            accessibilityRole="button"
            accessibilityLabel={`Shift ${s.local_date}`}
            onPress={() => navigation.navigate('ShiftDetail', { clientId: s.client_id })}
            style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: theme.border }}
          >
            <Text style={{ color: theme.text, fontSize: 18 }}>
              {s.local_date}
              {s.status === 'active' ? '  (running)' : ''}
            </Text>
            <Text style={{ color: theme.text }}>
              {s.total_m === null ? '-' : formatDistance(s.total_m, unit)}
            </Text>
            <Text style={{ color: theme.textMuted }}>
              {s.status === 'active' ? 'In progress' : totalsCaption(s)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}
