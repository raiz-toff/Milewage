import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '@milewage/shared';
import {
  advance,
  describeLadder,
  initialLadder,
  refresh,
  type LadderState,
  type StepId,
} from '../permissions/ladder';
import { useServices } from '../services';
import { useTheme } from '../theme/theme';
import { Screen } from './Screen';

const TITLES: Record<StepId, string> = {
  disclosure: 'Location use',
  foreground: 'Location while using the app',
  background: 'Location all the time',
  activity: 'Activity recognition',
  notifications: 'Notifications',
  battery: 'Battery settings',
};

/** Shown before the first OS prompt; wording follows the Play prominent-disclosure rule. */
export const DISCLOSURE =
  'MileWage records your location, including when the app is closed or the screen is off, from when you start a shift until you end it. It uses this only to count your miles and sends it to your own server.';

const ACTIONS: Record<StepId, string> = {
  disclosure: 'I understand',
  foreground: 'Allow location',
  background: 'Allow all the time',
  activity: 'Allow activity recognition',
  notifications: 'Allow notifications',
  battery: 'Open battery settings',
};

export function PermissionsScreen() {
  const { permissions, tracker } = useServices();
  const theme = useTheme();
  const [state, setState] = useState<LadderState>(initialLadder());

  const reread = useCallback(async () => {
    setState((s) => ({ ...s }));
    const snap = await permissions.snapshot();
    setState((s) => ({ ...s, snapshot: snap }));
  }, [permissions]);

  useEffect(() => {
    void reread();
    // Coming back from system settings changes permissions without a prompt.
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void reread();
    });
    return () => sub.remove();
  }, [reread]);

  const view = describeLadder(state);

  const onAction = async () => {
    if (view.next === 'battery') tracker.requestBatteryOptimizationSettings();
    setState(await advance(permissions, state));
  };

  return (
    <Screen title="Permissions">
      {!state.disclosureAccepted && <Text style={{ color: theme.text }}>{DISCLOSURE}</Text>}
      {view.steps.map((step) => (
        <View key={step.id} style={styles.row} testID={`step-${step.id}`}>
          <Text style={{ color: theme.text }}>{TITLES[step.id]}</Text>
          <Text style={{ color: theme.textMuted }}>
            {step.state === 'done'
              ? 'Done'
              : step.state === 'blocked'
                ? 'Blocked: change in system settings'
                : step.required
                  ? 'Required'
                  : 'Recommended'}
          </Text>
        </View>
      ))}
      {view.warnings.map((w) => (
        <Text key={w} accessibilityRole="alert" style={{ color: theme.text, marginTop: 8 }}>
          {w}
        </Text>
      ))}
      {view.next && (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={[styles.button, { borderColor: theme.border, backgroundColor: theme.card }]}
        >
          <Text style={{ color: theme.accent }}>{ACTIONS[view.next]}</Text>
        </Pressable>
      )}
      {view.steps.some((s) => s.state === 'blocked') && (
        <Pressable
          accessibilityRole="button"
          onPress={() => void permissions.openAppSettings()}
          style={[styles.button, { borderColor: theme.border, backgroundColor: theme.card }]}
        >
          <Text style={{ color: theme.accent }}>Open app settings</Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        onPress={() => void refresh(permissions, state).then(setState)}
      >
        <Text style={{ color: theme.textMuted, marginTop: 16 }}>Check again</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 8 },
  button: {
    marginTop: 16,
    minHeight: touchTarget.min,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
  },
});
