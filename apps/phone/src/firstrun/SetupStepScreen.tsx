import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform, View } from 'react-native';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Text } from '../components/ui/text';
import type { ScreenProps } from '../navigation';
import {
  advance,
  BATTERY_VISITED,
  describeLadder,
  initialLadder,
  refresh,
  skip,
  type LadderState,
  type StepId,
} from '../permissions/ladder';
import { DISCLOSURE } from '../screens/PermissionsScreen';
import { useServices } from '../services';
import { Screen } from '../ui/Screen';
import { useToast } from '../ui/Toast';

const SAMSUNG = [
  'Settings, Apps, MileWage, Battery: choose Unrestricted.',
  'Settings, Battery, Background usage limits: add MileWage to Never sleeping apps.',
];
const OTHER = [
  'Settings, Apps, MileWage, Battery: choose Unrestricted or Don’t optimise.',
  'Some phones also stop apps to save power. dontkillmyapp.com lists the steps for each make.',
];

/** One screen per step of the permission ladder (24 section 4.2, screens 6 to 9). */
const STEPS: Record<StepId, { title: string; text: string; action: string; lines?: string[] }> = {
  disclosure: { title: 'Location use', text: DISCLOSURE, action: 'I understand' },
  foreground: {
    title: 'Location while using',
    text: 'MileWage records your route while a shift runs. Android asks next.',
    action: 'Allow location',
  },
  background: {
    title: 'Location all the time',
    text: 'So recording goes on with the screen off or another app in front. In the settings that open, choose "Allow all the time".',
    action: 'Open settings',
    lines: [
      'Without it, recording can stop when the screen is off, and a stopped tracker cannot restart until you open MileWage.',
    ],
  },
  activity: {
    title: 'Movement',
    text: 'MileWage turns GPS off while you stand still, to save battery.',
    action: 'Allow movement',
  },
  notifications: {
    title: 'Notifications',
    text: "See your shift's time and distance in the notification bar.",
    action: 'Allow notifications',
  },
  battery: {
    title: 'Keep MileWage running',
    text: 'Phones stop apps to save battery. Let MileWage run during shifts:',
    action: 'Open battery settings',
  },
};

/**
 * The permission steps after connecting. The ladder decides what is needed and in which order;
 * a granted step is never shown; "Not now" leaves it on the Home checklist. Then Ready.
 */
export function SetupStepScreen({ navigation }: ScreenProps<'SetupStep'>) {
  const { permissions, tracker, plain } = useServices();
  const toast = useToast();
  const [state, setState] = useState<LadderState | null>(null);

  const reread = useCallback(async () => {
    const snap = await permissions.snapshot();
    const battery = (await plain.get(BATTERY_VISITED)) === '1';
    setState((s) => (s ? { ...s, snapshot: snap } : initialLadder(snap, battery)));
  }, [permissions, plain]);
  useEffect(() => {
    void reread();
    // Coming back from system settings changes permissions without a prompt.
    const sub = AppState.addEventListener('change', (a) => a === 'active' && void reread());
    return () => sub.remove();
  }, [reread]);

  const next = state ? describeLadder(state).next : null;
  useEffect(() => {
    if (state && next === null) navigation.replace('Ready');
  }, [state, next, navigation]);
  if (!state || !next) return <Screen title="Permissions" />;

  const step = STEPS[next];
  const samsung = /samsung/i.test(String((Platform.constants as { Brand?: string }).Brand));
  const lines = next === 'battery' ? (samsung ? SAMSUNG : OTHER) : (step.lines ?? []);
  const act = async () => {
    try {
      if (next === 'battery') {
        tracker.requestBatteryOptimizationSettings();
        await plain.set(BATTERY_VISITED, '1');
      }
      const after = await advance(permissions, state);
      setState(next === 'background' ? await refresh(permissions, after) : after);
    } catch {
      toast.show({
        tone: 'error',
        title: 'Android did not open it.',
        action: { label: 'Open app settings', onPress: () => void permissions.openAppSettings() },
      });
    }
  };

  return (
    <Screen
      title={step.title}
      description={step.text}
      footer={
        <View className="gap-3">
          <Button size="lg" onPress={() => void act()}>
            <Text>{step.action}</Text>
          </Button>
          <Button variant="ghost" onPress={() => setState(skip(state))}>
            <Text className="text-muted-foreground">Not now</Text>
          </Button>
        </View>
      }
    >
      {lines.length > 0 && (
        <Card>
          <CardContent>
            {lines.map((l) => (
              <Text key={l}>{l}</Text>
            ))}
          </CardContent>
        </Card>
      )}
    </Screen>
  );
}
