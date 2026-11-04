import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';
import { touchTarget } from '@milewage/shared';
import type { ScreenProps } from '../navigation';
import { deriveFlags } from '../pairing/pairing';
import { canStartShift, initialLadder } from '../permissions/ladder';
import { useServices } from '../services';
import type { ActiveShift, ServerShift, Vehicle } from '../shift/controller';
import { useTheme } from '../theme/theme';
import { Screen } from './Screen';

const M_PER_UNIT = { km: 1000, mi: 1609.344 } as const;

const MESSAGES: Record<string, string> = {
  not_paired: 'Pair this phone first (Settings).',
  tracker_refused: 'The tracker could not start. Check location permission and location services.',
  rejected: 'The server refused this shift.',
  no_permission: 'Location permission is needed to record a shift.',
  active_local: 'The previous shift is still being sent. Try again when it has been.',
};

export function HomeScreen({ navigation }: ScreenProps<'Home'>) {
  const theme = useTheme();
  const {
    shift: controller,
    uploader,
    autoUpload = true,
    pairing,
    permissions,
    refreshMs = 5000,
  } = useServices();
  const [shift, setShift] = useState<ActiveShift | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [unit, setUnit] = useState<'km' | 'mi'>('km');
  const [meters, setMeters] = useState(0);
  const [odometer, setOdometer] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ServerShift | null>(null);
  const [ready, setReady] = useState(false);
  const [paired, setPaired] = useState(false);
  const [uploadState, setUploadState] = useState(uploader.lastState);

  useEffect(() => {
    void (async () => {
      const state = await pairing.load();
      setUnit(deriveFlags(state?.settings ?? null).distanceUnit);
      setShift(await controller.load());
      setPaired(!!state);
      if (state) {
        try {
          setVehicles(await controller.vehicles());
        } catch {
          setMessage('Cannot reach the server. A shift can still be started later.');
        }
        void controller.sync();
      }
      setReady(true);
    })();
  }, [controller, pairing]);

  useEffect(() => {
    if (!shift || shift.endedAt !== null) return;
    setMeters(controller.pump());
    const timer = setInterval(() => setMeters(controller.pump()), refreshMs);
    return () => clearInterval(timer);
  }, [controller, shift, refreshMs]);

  useEffect(() => {
    if (!paired || !autoUpload) return;
    uploader.start();
    const timer = setInterval(() => setUploadState(uploader.lastState), refreshMs);
    return () => {
      uploader.stop();
      clearInterval(timer);
    };
  }, [paired, autoUpload, uploader, refreshMs]);

  const toMeters = (text: string) => {
    const n = Number(text.replace(',', '.'));
    return text.trim() !== '' && Number.isFinite(n) && n >= 0
      ? Math.round(n * M_PER_UNIT[unit])
      : null;
  };

  const start = useCallback(async () => {
    setMessage(null);
    const snap = await permissions.snapshot();
    if (!canStartShift(initialLadder(snap))) return setMessage(MESSAGES.no_permission!);
    const vehicle = vehicles[0];
    if (!vehicle) return setMessage('Add a vehicle on the web first.');
    const result = await controller.start({
      vehicleId: vehicle.id,
      odometerStartM: toMeters(odometer),
    });
    if (result.ok) {
      setShift(result.shift);
      setOdometer('');
    } else if (result.reason === 'server_has_active') {
      setConflict(result.active);
    } else {
      setMessage(MESSAGES[result.reason] ?? 'Could not start the shift.');
    }
  }, [controller, permissions, vehicles, odometer, unit]);

  const adopt = async () => {
    if (!conflict) return;
    const result = await controller.adopt(conflict);
    setConflict(null);
    if (result.ok) setShift(result.shift);
    else setMessage(MESSAGES[result.reason] ?? 'Could not resume the shift.');
  };

  const end = async () => {
    const result = await controller.end({ odometerEndM: toMeters(odometer) });
    setOdometer('');
    if (result.ok) {
      setShift(controller.current);
      setMeters(0);
      setMessage(
        result.sent ? 'Shift ended.' : 'Shift ended. It will be sent when the server is reachable.',
      );
    }
  };

  const button = [styles.button, { borderColor: theme.border, backgroundColor: theme.card }];
  const running = shift && shift.endedAt === null;
  const distance = (meters / M_PER_UNIT[unit]).toFixed(1);

  return (
    <Screen title="MileWage">
      {!ready ? null : running ? (
        <>
          <Text style={{ color: theme.text, fontSize: 20 }}>Shift running</Text>
          <Text accessibilityLabel="Distance" style={{ color: theme.text, fontSize: 40 }}>
            {distance} {unit}
          </Text>
          <Text style={{ color: theme.textMuted }}>
            Approximate; the server calculates the total.
          </Text>
          {!shift.created && (
            <Text style={{ color: theme.textMuted }}>Not yet sent to the server.</Text>
          )}
          <Text style={{ color: theme.textMuted, marginTop: 12 }}>
            Odometer{' '}
            {shift.odometerStartM === null
              ? 'not set'
              : `at start: ${(shift.odometerStartM / M_PER_UNIT[unit]).toFixed(1)} ${unit}`}
          </Text>
        </>
      ) : (
        <Text style={{ color: theme.textMuted }}>
          {shift ? 'Shift ended; waiting to send.' : 'No shift running.'}
        </Text>
      )}
      {ready && (
        <TextInput
          accessibilityLabel={running ? 'Odometer' : 'Odometer at start'}
          placeholder={`Odometer (${unit})`}
          placeholderTextColor={theme.textMuted}
          keyboardType="decimal-pad"
          value={odometer}
          onChangeText={setOdometer}
          style={{
            color: theme.text,
            borderColor: theme.border,
            borderWidth: 1,
            marginTop: 12,
            padding: 8,
          }}
        />
      )}
      {running && (
        <Pressable
          accessibilityRole="button"
          onPress={async () => {
            const m = toMeters(odometer);
            if (m !== null) await controller.setOdometerStart(m);
            setShift(controller.current);
            setOdometer('');
          }}
          style={button}
        >
          <Text style={{ color: theme.accent }}>Save start odometer</Text>
        </Pressable>
      )}
      {ready && !running && (
        <Pressable accessibilityRole="button" onPress={start} style={button}>
          <Text style={{ color: theme.accent }}>Start shift</Text>
        </Pressable>
      )}
      {running && (
        <Pressable accessibilityRole="button" onPress={end} style={button}>
          <Text style={{ color: theme.accent }}>End shift</Text>
        </Pressable>
      )}
      {conflict && (
        <>
          <Text accessibilityRole="alert" style={{ color: theme.text, marginTop: 12 }}>
            A shift is already running on the server. Continue it?
          </Text>
          <Pressable accessibilityRole="button" onPress={adopt} style={button}>
            <Text style={{ color: theme.accent }}>Continue that shift</Text>
          </Pressable>
        </>
      )}
      {(uploadState === 'repair' || uploadState === 'auth_problem') && (
        <Text accessibilityRole="alert" style={{ color: theme.text, marginTop: 12 }}>
          {uploadState === 'repair'
            ? 'The server no longer accepts this phone. Pair it again in Settings. Recorded points are kept.'
            : 'Sign-in problem with the server. Recorded points are kept.'}
        </Text>
      )}
      {message && (
        <Text accessibilityRole="alert" style={{ color: theme.text, marginTop: 12 }}>
          {message}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        onPress={() => navigation.navigate('Settings')}
        style={button}
      >
        <Text style={{ color: theme.accent }}>Settings</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  button: {
    marginTop: 16,
    minHeight: touchTarget.min,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
  },
});
