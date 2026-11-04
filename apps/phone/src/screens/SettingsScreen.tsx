import { Text } from 'react-native';
import { useTheme } from '../theme/theme';
import { Screen } from './Screen';

/** Placeholder settings; pairing arrives in M4.6, diagnostics in M4.9. */
export function SettingsScreen() {
  const theme = useTheme();
  return (
    <Screen title="Settings">
      <Text style={{ color: theme.textMuted }}>Not paired.</Text>
    </Screen>
  );
}
