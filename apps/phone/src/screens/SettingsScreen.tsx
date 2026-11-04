import { Pressable, Text } from 'react-native';
import type { ScreenProps } from '../navigation';
import { useTheme } from '../theme/theme';
import { Screen } from './Screen';

/** Placeholder settings; pairing arrives in M4.6, diagnostics in M4.9. */
export function SettingsScreen({ navigation }: ScreenProps<'Settings'>) {
  const theme = useTheme();
  return (
    <Screen title="Settings">
      <Text style={{ color: theme.textMuted }}>Not paired.</Text>
      <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Permissions')}>
        <Text style={{ color: theme.accent, marginTop: 16 }}>Permissions</Text>
      </Pressable>
    </Screen>
  );
}
