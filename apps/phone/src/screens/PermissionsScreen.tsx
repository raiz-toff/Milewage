import { useCallback, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Activity,
  AlertTriangle,
  Bell,
  BatteryCharging,
  Check,
  Info,
  MapPin,
  Navigation,
} from 'lucide-react-native';
import {
  advance,
  BATTERY_VISITED,
  canStartShift,
  describeLadder,
  DISCLOSURE_ACCEPTED,
  initialLadder,
  loadLadder,
  type LadderState,
  type StepId,
} from '../permissions/ladder';
import type { ScreenProps } from '../navigation';
import { useServices } from '../services';
import { useToast } from '../ui/Toast';
import { useColors } from '../theme/theme';
import { Alert, AlertTitle } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Text } from '../components/ui/text';
import { cn } from '../lib/utils';
import { Rows, type IconType } from '../ui/Parts';
import { Screen } from '../ui/Screen';

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

const ICONS: Record<StepId, IconType> = {
  disclosure: Info,
  foreground: MapPin,
  background: Navigation,
  activity: Activity,
  notifications: Bell,
  battery: BatteryCharging,
};

const ACTIONS: Record<StepId, string> = {
  disclosure: 'I understand',
  foreground: 'Allow location',
  background: 'Allow all the time',
  activity: 'Allow activity recognition',
  notifications: 'Allow notifications',
  battery: 'Open battery settings',
};

export function PermissionsScreen({ navigation }: ScreenProps<'Permissions'>) {
  const toast = useToast();
  const { permissions, tracker, plain } = useServices();
  // null until the first read lands: nothing is shown as missing before Android has answered.
  const [state, setState] = useState<LadderState | null>(null);
  // Each read or action takes a ticket; a read that resolves after a newer one started is stale.
  const ticket = useRef(0);

  const reread = useCallback(async () => {
    const mine = ++ticket.current;
    const fresh = await loadLadder(permissions, plain);
    if (mine !== ticket.current) return;
    setState((s) =>
      s
        ? {
            ...fresh,
            skipped: s.skipped,
            disclosureAccepted: s.disclosureAccepted || fresh.disclosureAccepted,
            batteryVisited: s.batteryVisited || fresh.batteryVisited,
          }
        : fresh,
    );
  }, [permissions, plain]);

  // Re-read on every visit, and when the app comes back from system settings, where permissions
  // change without a prompt. Leaving the screen invalidates any read still in flight.
  useFocusEffect(
    useCallback(() => {
      void reread();
      const sub = AppState.addEventListener('change', (next) => {
        if (next === 'active') void reread();
      });
      return () => {
        sub.remove();
        ticket.current++;
      };
    }, [reread]),
  );

  const view = describeLadder(state ?? initialLadder());

  const onAction = async () => {
    if (!state) return;
    ticket.current++; // a read started before the prompt must not overwrite its answer
    try {
      if (view.next === 'disclosure') await plain.set(DISCLOSURE_ACCEPTED, '1');
      if (view.next === 'battery') {
        tracker.requestBatteryOptimizationSettings();
        await plain.set(BATTERY_VISITED, '1'); // for the Home checklist
      }
      setState(await advance(permissions, state));
    } catch {
      toast.show({
        tone: 'error',
        title: 'Android did not open the permission prompt.',
        action: { label: 'Open app settings', onPress: () => void permissions.openAppSettings() },
      });
    }
  };
  const ready = state !== null && canStartShift(state);

  const C = useColors();
  const status = (step: (typeof view.steps)[number]) =>
    !state
      ? ({ label: 'Checking', variant: 'outline' } as const)
      : step.state === 'done'
        ? ({ label: 'Done', variant: 'secondary' } as const)
        : step.state === 'blocked'
          ? ({ label: 'Blocked', variant: 'destructive' } as const)
          : step.required
            ? ({ label: 'Required', variant: 'default' } as const)
            : ({ label: 'Recommended', variant: 'outline' } as const);
  const done = view.steps.filter((x) => x.state === 'done').length;

  return (
    <Screen
      title="Permissions"
      description="What MileWage needs to record a shift with the screen off."
    >
      {state && !state.disclosureAccepted && (
        <Card>
          <CardHeader>
            <CardTitle>Location use</CardTitle>
            <CardDescription>{DISCLOSURE}</CardDescription>
          </CardHeader>
        </Card>
      )}
      <Card className="pb-0">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Steps</CardTitle>
          <Text variant="muted" tabular>
            {state ? `${done} of ${view.steps.length} done` : 'Checking…'}
          </Text>
        </CardHeader>
        <View className="border-t border-border">
          <Rows>
            {view.steps.map((step) => {
              const st = status(step);
              const ok = !!state && step.state === 'done';
              const Icon = ok ? Check : ICONS[step.id];
              return (
                <View
                  key={step.id}
                  testID={`step-${step.id}`}
                  className="min-h-[56px] flex-row items-center gap-3 px-4 py-2"
                >
                  <View
                    className={cn(
                      'h-9 w-9 items-center justify-center rounded-lg',
                      ok ? 'bg-primary' : 'bg-muted',
                    )}
                  >
                    <Icon size={18} color={ok ? C.primaryForeground : C.foreground} />
                  </View>
                  <Text variant="label" className="flex-1">
                    {TITLES[step.id]}
                  </Text>
                  <Badge variant={st.variant}>
                    <Text>{st.label}</Text>
                  </Badge>
                </View>
              );
            })}
          </Rows>
        </View>
      </Card>
      {(state ? view.warnings : []).map((w) => (
        <Alert key={w} icon={AlertTriangle}>
          <AlertTitle accessibilityRole="alert">{w}</AlertTitle>
        </Alert>
      ))}
      {ready && (
        <Card>
          <CardHeader className="flex-row items-start gap-3">
            <View className="h-9 w-9 items-center justify-center rounded-full bg-primary">
              <Check size={18} color={C.primaryForeground} strokeWidth={2.5} />
            </View>
            <View className="flex-1 gap-1">
              <CardTitle>You can record shifts.</CardTitle>
              <CardDescription>
                {view.next
                  ? 'The steps left are recommended; they keep recording reliable with the screen off.'
                  : 'Everything MileWage needs is allowed.'}
              </CardDescription>
            </View>
          </CardHeader>
          <CardContent>
            <Button
              variant={view.next ? 'outline' : 'default'}
              onPress={() => navigation.navigate('Home')}
            >
              <Text>Back to home</Text>
            </Button>
          </CardContent>
        </Card>
      )}
      <CardContent className="px-0">
        {state && view.next && (
          <Button size="lg" onPress={onAction}>
            <Text>{ACTIONS[view.next]}</Text>
          </Button>
        )}
        {state && view.steps.some((x) => x.state === 'blocked') && (
          <Button variant="outline" onPress={() => void permissions.openAppSettings()}>
            <Text>Open app settings</Text>
          </Button>
        )}
        <Button variant="ghost" onPress={() => void reread()}>
          <Text className="text-muted-foreground">Check again</Text>
        </Button>
      </CardContent>
    </Screen>
  );
}
