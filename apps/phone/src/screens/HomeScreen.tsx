import { Pressable, StyleSheet, Text } from 'react-native';
import { touchTarget } from '@milewage/shared';
import { useTheme } from '../theme/theme';
import type { ScreenProps } from '../navigation';
import { Screen } from './Screen';

/** Placeholder home; the Start / End shift screen arrives in M4.7. */
export function HomeScreen({ navigation }: ScreenProps<'Home'>) {
  const theme = useTheme();
  return (
    <Screen title="MileWage">
      <Text style={{ color: theme.textMuted }}>No shift running.</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => navigation.navigate('Settings')}
        style={[styles.button, { borderColor: theme.border, backgroundColor: theme.card }]}
      >
        <Text style={{ color: theme.accent }}>Settings</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  button: {
    marginTop: 24,
    minHeight: touchTarget.min,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
  },
});
