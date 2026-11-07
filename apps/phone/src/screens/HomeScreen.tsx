import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  AlertTriangle,
  Car,
  History,
  Info,
  Play,
  Settings as SettingsIcon,
} from 'lucide-react-native';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Separator } from '../components/ui/separator';
import { Skeleton } from '../components/ui/skeleton';
import { Text } from '../components/ui/text';
import type { ScreenProps } from '../navigation';
import { M_PER_UNIT, formatClock } from '../format';
import { cn } from '../lib/utils';
import { deriveFlags } from '../pairing/pairing';
import { canStartShift, initialLadder } from '../permissions/ladder';
import { useServices } from '../services';
import type { ActiveShift, ServerShift, Vehicle } from '../shift/controller';
import { useColors } from '../theme/theme';
import { Field } from '../ui/Field';
import { useToast } from '../ui/Toast';
import { Dot } from '../ui/Parts';
import { Screen } from '../ui/Screen';
import { SwipeButton } from '../components/ui/swipe-button';
import { HomeSummary } from './HomeSummary';
import { SetupChecklist } from './SetupChecklist';
import { SyncBanner } from './SyncBanner';

const DIAG_WINDOW_MS = 10 * 60 * 1000;

/** "1:04:09" from milliseconds. */
function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
}

export function HomeScreen({ navigation }: ScreenProps<'Home'>) {
  const C = useColors();
  const {
    shift: controller,
    uploader,
    sync,
    startDiagnostics,
    diagnosticsWindow,
    autoUpload = true,
    pairing,
    permissions,
    refreshMs = 5000,
  } = useServices();
  const toast = useToast();
  const [shift, setShift] = useState<ActiveShift | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  /** null: loaded from the server; 'kept': the copy from the last connection; 'none': nothing. */
  const [vehicleSource, setVehicleSource] = useState<'server' | 'kept' | 'none'>('server');
  const [localConflict, setLocalConflict] = useState<ServerShift | null>(null);
  const [unit, setUnit] = useState<'km' | 'mi'>('km');
  const [zone, setZone] = useState('UTC');
  const [meters, setMeters] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [odometer, setOdometer] = useState('');
  const [busy, setBusy] = useState<'start' | 'end' | null>(null);
  const [conflict, setConflict] = useState<ServerShift | null>(null);
  const [ready, setReady] = useState(false);
  const [paired, setPaired] = useState(false);
  const [located, setLocated] = useState(true);
  const [uploadState, setUploadState] = useState(uploader.lastState);
  const [progress, setProgress] = useState(sync.progress);

  const goSettings = () => navigation.navigate('Settings');
  const goPermissions = () => navigation.navigate('Permissions');

  const loadVehicles = useCallback(async () => {
    try {
      const list = await controller.vehicles();
      const last = await controller.lastVehicleId();
      setVehicles(list);
      setVehicleSource(list.offline ? 'kept' : 'server');
      setVehicleId(
        (prev) =>
          list.find((v) => v.id === prev)?.id ??
          list.find((v) => v.id === last)?.id ??
          list[0]?.id ??
          null,
      );
      return true;
    } catch {
      setVehicleSource('none');
      return false;
    }
  }, [controller]);

  // Reloaded on every visit: pairing or a permission may have changed on another screen.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      void (async () => {
        const state = await pairing.load();
        const flags = deriveFlags(state?.settings ?? null);
        const current = await controller.load();
        const snap = await permissions.snapshot();
        if (!live) return;
        setUnit(flags.distanceUnit);
        setZone(flags.timezone);
        setShift(current);
        setLocalConflict(controller.conflict);
        setPaired(!!state);
        setLocated(canStartShift(initialLadder(snap)));
        if (state) {
          await loadVehicles();
          void controller.sync().then(() => live && setLocalConflict(controller.conflict));
        }
        if (live) setReady(true);
      })();
      return () => {
        live = false;
      };
    }, [controller, pairing, permissions, loadVehicles]),
  );

  useEffect(() => {
    if (!shift || shift.endedAt !== null) return;
    setMeters(controller.pump());
    const timer = setInterval(() => setMeters(controller.pump()), refreshMs);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      clearInterval(clock);
    };
  }, [controller, shift, refreshMs]);

  useEffect(() => {
    if (!paired || !autoUpload) return;
    sync.start();
    const unsubscribe = sync.subscribe(setProgress);
    void startDiagnostics();
    const diagTimer = setInterval(() => void diagnosticsWindow(), DIAG_WINDOW_MS);
    const timer = setInterval(() => setUploadState(uploader.lastState), refreshMs);
    return () => {
      sync.stop();
      unsubscribe();
      clearInterval(diagTimer);
      clearInterval(timer);
    };
  }, [paired, autoUpload, uploader, sync, refreshMs, startDiagnostics, diagnosticsWindow]);

  /** Metres from the typed reading; null when empty; NaN when it is not a number. */
  const toMeters = (text: string) => {
    if (text.trim() === '') return null;
    const n = Number(text.replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? Math.round(n * M_PER_UNIT[unit]) : NaN;
  };
  const badReading = () =>
    toast.show({
      tone: 'error',
      title: 'That odometer reading is not a number.',
      description: `Type the reading in ${unit === 'mi' ? 'miles' : 'kilometres'}, for example 12480.`,
    });

  const startFailed = (reason: string) => {
    const problems: Record<string, Parameters<typeof toast.show>[0]> = {
      not_paired: {
        title: 'Pair this phone first.',
        description: 'Shifts are recorded for your MileWage server.',
        action: { label: 'Pair now', onPress: goSettings },
      },
      tracker_refused: {
        title: 'The tracker could not start.',
        description: 'Check that location is on and that MileWage may use it all the time.',
        action: { label: 'Open permissions', onPress: goPermissions },
      },
      rejected: {
        title: 'The server refused this shift.',
        description:
          'Nothing was recorded. Try again; if it keeps happening, check Shifts on the web.',
      },
      active_local: {
        title: 'The previous shift is still being sent.',
        description: 'Start again when it is on the server.',
        action: { label: 'Send it now', onPress: () => void controller.sync() },
      },
    };
    toast.show({ tone: 'error', ...(problems[reason] ?? { title: 'Could not start the shift.' }) });
  };

  const start = useCallback(async () => {
    if (busy) return;
    const snap = await permissions.snapshot();
    if (!canStartShift(initialLadder(snap))) {
      return toast.show({
        tone: 'error',
        title: 'Location permission is needed to record a shift.',
        action: { label: 'Fix permissions', onPress: goPermissions },
      });
    }
    if (!paired) return startFailed('not_paired');
    const vehicle = vehicles.find((v) => v.id === vehicleId);
    if (!vehicle) {
      return toast.show(
        vehicleSource === 'none'
          ? {
              tone: 'error',
              title: 'Your vehicles have not loaded.',
              description: 'Connect to the internet once so the phone can keep your vehicle list.',
              action: { label: 'Try again', onPress: () => void loadVehicles() },
            }
          : {
              tone: 'error',
              title: 'Add a vehicle on the web first.',
              description: 'Open Vehicles on your MileWage web app, then try again here.',
              action: { label: 'Try again', onPress: () => void loadVehicles() },
            },
      );
    }
    const startM = toMeters(odometer);
    if (Number.isNaN(startM)) return badReading();
    setBusy('start');
    try {
      const result = await controller.start({ vehicleId: vehicle.id, odometerStartM: startM });
      if (result.ok) {
        setShift(result.shift);
        setOdometer('');
        setNow(Date.now());
      } else if (result.reason === 'server_has_active') {
        setConflict(result.active);
      } else {
        startFailed(result.reason);
      }
    } catch {
      toast.show({
        tone: 'error',
        title: 'Could not start the shift.',
        description: 'Nothing was recorded. Try again.',
      });
    } finally {
      setBusy(null);
    }
  }, [busy, controller, permissions, paired, vehicles, vehicleId, vehicleSource, odometer, unit]);

  const adopt = async () => {
    if (!conflict) return;
    try {
      const result = await controller.adopt(conflict);
      setConflict(null);
      if (result.ok) setShift(result.shift);
      else startFailed(result.reason);
    } catch {
      toast.show({
        tone: 'error',
        title: 'Could not continue that shift.',
        description: 'Try again.',
      });
    }
  };

  const resolveConflict = async (useServer: boolean) => {
    try {
      if (useServer) {
        const result = await controller.useServerShift();
        if (result.ok) setShift(result.shift);
        else startFailed(result.reason);
      } else {
        await controller.keepLocalShift();
      }
      setLocalConflict(null);
    } catch {
      toast.show({ tone: 'error', title: 'That did not work.', description: 'Try again.' });
    }
  };

  const end = async () => {
    if (busy) return;
    const endM = toMeters(odometer);
    if (Number.isNaN(endM)) return badReading();
    const id = shift?.clientId ?? null;
    setBusy('end');
    try {
      const result = await controller.end({ odometerEndM: endM });
      setOdometer('');
      if (result.ok) {
        setShift(controller.current);
        setMeters(0);
        toast.show({
          tone: 'success',
          title: 'Shift ended.',
          description: result.sent ? undefined : 'It will be sent when the server is reachable.',
          action: id
            ? {
                label: 'View shift',
                onPress: () => navigation.navigate('ShiftDetail', { clientId: id }),
              }
            : undefined,
        });
      }
    } catch {
      toast.show({
        tone: 'error',
        title: 'Could not end the shift.',
        description: 'It is still recording. Try again.',
      });
    } finally {
      setBusy(null);
    }
  };

  const saveStartOdometer = async () => {
    const m = toMeters(odometer);
    if (m === null) return;
    if (Number.isNaN(m)) return badReading();
    try {
      await controller.setOdometerStart(m);
      setShift(controller.current);
      setOdometer('');
      toast.show({ tone: 'success', title: 'Start odometer saved.' });
    } catch {
      toast.show({
        tone: 'error',
        title: 'Could not save the reading.',
        description: 'Try again.',
      });
    }
  };

  const running = !!shift && shift.endedAt === null;
  const distance = (meters / M_PER_UNIT[unit]).toFixed(1);
  const notices = (
    <>
      {conflict && (
        <Alert icon={AlertTriangle}>
          <AlertTitle accessibilityRole="alert">
            A shift is already running on the server. Continue it?
          </AlertTitle>
          <Button variant="outline" size="sm" className="mt-1 self-start" onPress={adopt}>
            <Text>Continue that shift</Text>
          </Button>
        </Alert>
      )}
      {localConflict && (
        <Alert icon={AlertTriangle}>
          <AlertTitle accessibilityRole="alert">
            Another shift is already running on the server, so this phone&apos;s shift could not be
            sent. Its miles are still being recorded here.
          </AlertTitle>
          <AlertDescription>
            Continuing the server shift drops the miles recorded in this phone&apos;s own shift.
          </AlertDescription>
          <View className="gap-2 pt-1">
            <Button variant="outline" size="sm" onPress={() => resolveConflict(false)}>
              <Text>Keep this shift and try later</Text>
            </Button>
            <Button variant="outline" size="sm" onPress={() => resolveConflict(true)}>
              <Text>Continue the server shift instead</Text>
            </Button>
          </View>
        </Alert>
      )}
      {(uploadState === 'repair' || uploadState === 'auth_problem') && (
        <Alert variant="destructive" icon={AlertTriangle}>
          <AlertTitle accessibilityRole="alert">
            {uploadState === 'repair'
              ? 'The server no longer accepts this phone. Pair it again in Settings. Recorded points are kept.'
              : 'Sign-in problem with the server. Recorded points are kept.'}
          </AlertTitle>
        </Alert>
      )}
      {progress.phase === 'running' && progress.shiftsTotal > 0 && (
        <Alert icon={Info}>
          <AlertTitle accessibilityLabel="Sending progress" tabular>
            Sending {progress.pointsSent} of {progress.pointsTotal} points, shift{' '}
            {Math.min(progress.shiftsDone + 1, progress.shiftsTotal)} of {progress.shiftsTotal}
          </AlertTitle>
          <Button
            variant="outline"
            size="sm"
            className="mt-1 self-start"
            onPress={() => sync.cancel()}
          >
            <Text>Stop sending</Text>
          </Button>
        </Alert>
      )}
    </>
  );

  const nav = (
    <View className="flex-row gap-1">
      <Button
        variant="ghost"
        size="icon"
        accessibilityLabel="Shifts"
        onPress={() => navigation.navigate('Shifts')}
      >
        <History size={20} color={C.foreground} />
      </Button>
      <Button variant="ghost" size="icon" accessibilityLabel="Settings" onPress={goSettings}>
        <SettingsIcon size={20} color={C.foreground} />
      </Button>
    </View>
  );

  if (running && shift) {
    return (
      <Screen
        title="Shift running"
        header={
          <View className="flex-row items-center justify-between px-4 pt-2">
            <View className="flex-row items-center gap-2">
              <Text variant="h4" accessibilityRole="header">
                Shift running
              </Text>
              <Badge variant="outline">
                <Dot color={C.signal} size={6} pulse />
                <Text>Recording</Text>
              </Badge>
            </View>
            {nav}
          </View>
        }
        footer={
          busy === 'end' ? (
            <Button size="lg" variant="secondary" disabled accessibilityLabel="Ending shift">
              <ActivityIndicator color={C.foreground} />
              <Text>Ending shift…</Text>
            </Button>
          ) : (
            <SwipeButton
              variant="destructive"
              label="Swipe to end shift"
              accessibilityLabel="End shift"
              onConfirm={() => void end()}
            />
          )
        }
      >
        <View className="items-center gap-2 py-6">
          <Text
            tabular
            accessibilityLabel="Elapsed time"
            numberOfLines={1}
            className="font-sans-semibold tracking-tight"
            style={{ fontSize: 56, lineHeight: 64 }}
          >
            {elapsed(now - shift.startedAt)}
          </Text>
          <Text variant="muted">{`Since ${formatClock(shift.startedAt, zone)}`}</Text>
        </View>
        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <View className="flex-1 gap-1">
              <CardDescription>Distance so far</CardDescription>
              <CardTitle
                tabular
                accessibilityLabel="Distance"
                className="font-sans-semibold text-4xl tracking-tight"
              >
                {distance} {unit}
              </CardTitle>
            </View>
            {shift.created ? (
              <Badge variant="secondary">
                <Text>On server</Text>
              </Badge>
            ) : (
              <Badge variant="outline">
                <Text>Not yet sent to the server</Text>
              </Badge>
            )}
          </CardHeader>
          <CardContent>
            <Text variant="muted">Approximate; the server calculates the total.</Text>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Odometer</CardTitle>
            <CardDescription>
              {shift.odometerStartM === null
                ? 'No start reading yet.'
                : `Start: ${(shift.odometerStartM / M_PER_UNIT[unit]).toFixed(1)} ${unit}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Field
              accessibilityLabel="Odometer"
              placeholder={`Reading (${unit})`}
              keyboardType="decimal-pad"
              value={odometer}
              onChangeText={setOdometer}
              hint="A reading typed here when you end the shift is saved as the end odometer."
            />
            <Button
              variant="outline"
              disabled={odometer.trim() === ''}
              onPress={() => void saveStartOdometer()}
            >
              <Text>Save start odometer</Text>
            </Button>
          </CardContent>
        </Card>
        {notices}
        {paired && <SyncBanner onSettings={goSettings} />}
      </Screen>
    );
  }

  const today = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now);

  return (
    <Screen
      title="MileWage"
      header={
        <View className="flex-row items-center justify-between px-4 pt-2">
          <View className="gap-0.5">
            <Text variant="h3" accessibilityRole="header">
              MileWage
            </Text>
            <Text variant="muted">{today}</Text>
          </View>
          {nav}
        </View>
      }
      footer={
        ready && (
          <Button
            size="lg"
            accessibilityLabel="Start shift"
            disabled={busy === 'start'}
            onPress={() => void start()}
          >
            {busy === 'start' ? (
              <ActivityIndicator color={C.primaryForeground} />
            ) : (
              <Play size={16} color={C.primaryForeground} fill={C.primaryForeground} />
            )}
            <Text>{busy === 'start' ? 'Starting…' : 'Start shift'}</Text>
          </Button>
        )
      }
    >
      {!ready ? (
        <View className="gap-3">
          <Skeleton className="h-10" />
          <Skeleton className="h-28 rounded-xl" />
          <View className="flex-row gap-3">
            <Skeleton className="h-20 flex-1 rounded-xl" />
            <Skeleton className="h-20 flex-1 rounded-xl" />
          </View>
        </View>
      ) : (
        <>
          {notices}
          <SetupChecklist
            items={[
              {
                key: 'pair',
                title: 'Pair this phone',
                detail: 'Scan the code from Devices on your MileWage web app.',
                done: paired,
                onPress: goSettings,
              },
              {
                key: 'location',
                title: 'Allow location',
                detail: 'Needed to count your miles while a shift runs.',
                done: located,
                onPress: goPermissions,
              },
            ]}
          />
          {paired && <HomeSummary refreshKey={shift?.endedAt ?? shift?.clientId} />}
          {paired && <SyncBanner onSettings={goSettings} />}
          <Card>
            <CardHeader>
              <CardTitle>Next shift</CardTitle>
              <CardDescription>
                {shift ? 'Shift ended; waiting to send.' : 'No shift running.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {vehicles.length > 1 && (
                <View accessibilityRole="radiogroup" className="gap-2">
                  <Text variant="label">Vehicle</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {vehicles.map((v) => {
                      const on = v.id === vehicleId;
                      return (
                        <Pressable
                          key={v.id}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: on }}
                          accessibilityLabel={v.name}
                          onPress={() => setVehicleId(v.id)}
                          className={cn(
                            'h-12 flex-row items-center gap-2 rounded-lg border px-4',
                            on ? 'border-primary bg-primary' : 'border-input bg-background',
                          )}
                        >
                          <Car size={16} color={on ? C.primaryForeground : C.foreground} />
                          <Text
                            variant="label"
                            className={on ? 'text-primary-foreground' : 'text-foreground'}
                          >
                            {v.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}
              {vehicles.length === 1 && (
                <View className="flex-row items-center gap-2">
                  <Car size={16} color={C.mutedForeground} />
                  <Text variant="muted">Vehicle: {vehicles[0]!.name}</Text>
                </View>
              )}
              {vehicleSource === 'kept' && (
                <Text variant="muted">Offline: using the vehicles from your last connection.</Text>
              )}
              {paired && vehicleSource === 'none' && (
                <View className="gap-2">
                  <Text variant="muted">
                    Your vehicles could not be loaded. Connect to the internet once so the phone can
                    keep them.
                  </Text>
                  <Button variant="outline" size="sm" onPress={() => void loadVehicles()}>
                    <Text>Try again</Text>
                  </Button>
                </View>
              )}
              {paired && vehicleSource === 'server' && vehicles.length === 0 && (
                <View className="gap-2">
                  <Text variant="muted">
                    No vehicles yet. Add one under Vehicles on your MileWage web app.
                  </Text>
                  <Button variant="outline" size="sm" onPress={() => void loadVehicles()}>
                    <Text>Check again</Text>
                  </Button>
                </View>
              )}
              <Separator />
              <Field
                label="Odometer at start"
                accessibilityLabel="Odometer at start"
                placeholder={`Optional, in ${unit}`}
                keyboardType="decimal-pad"
                value={odometer}
                onChangeText={setOdometer}
              />
            </CardContent>
          </Card>
        </>
      )}
    </Screen>
  );
}
