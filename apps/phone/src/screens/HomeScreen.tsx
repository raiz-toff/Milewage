import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { touchTarget } from '@milewage/shared';
import type { ScreenProps } from '../navigation';
import { M_PER_UNIT } from '../format';
import { deriveFlags } from '../pairing/pairing';
import { canStartShift, initialLadder } from '../permissions/ladder';
import { useServices } from '../services';
import type { ActiveShift, ServerShift, Vehicle } from '../shift/controller';
import { useTheme } from '../theme/theme';
import { Screen } from './Screen';

const DIAG_WINDOW_MS = 10 * 60 * 1000;

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
    startDiagnostics,
    diagnosticsWindow,
    autoUpload = true,
    pairing,
    permissions,
    refreshMs = 5000,
  } = useServices();
  const [shift, setShift] = useState<ActiveShift | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const [localConflict, setLocalConflict] = useState<ServerShift | null>(null);
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
      setLocalConflict(controller.conflict);
      setPaired(!!state);
      if (state) {
        try {
          const list = await controller.vehicles();
          setVehicles(list);
          const last = await controller.lastVehicleId();
          setVehicleId(list.find((v) => v.id === last)?.id ?? list[0]?.id ?? null);
        } catch {
          setMessage('Cannot reach the server. A shift can still be started later.');
        }
        void controller.sync().then(() => setLocalConflict(controller.conflict));
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
    void startDiagnostics();
    const diagTimer = setInterval(() => void diagnosticsWindow(), DIAG_WINDOW_MS);
    const timer = setInterval(() => setUploadState(uploader.lastState), refreshMs);
    return () => {
      uploader.stop();
      clearInterval(diagTimer);
      clearInterval(timer);
    };
  }, [paired, autoUpload, uploader, refreshMs, startDiagnostics, diagnosticsWindow]);

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
    const vehicle = vehicles.find((v) => v.id === vehicleId);
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
  }, [controller, permissions, vehicles, vehicleId, odometer, unit]);

  const adopt = async () => {
    if (!conflict) return;
    const result = await controller.adopt(conflict);
    setConflict(null);
    if (result.ok) setShift(result.shift);
    else setMessage(MESSAGES[result.reason] ?? 'Could not resume the shift.');
  };

  const resolveConflict = async (useServer: boolean) => {
    if (useServer) {
      const result = await controller.useServerShift();
      if (result.ok) setShift(result.shift);
      else setMessage(MESSAGES[result.reason] ?? 'Could not continue the server shift.');
    } else {
      await controller.keepLocalShift();
    }
    setLocalConflict(null);
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
      {ready && !running && vehicles.length > 1 && (
        <View accessibilityRole="radiogroup">
          <Text style={{ color: theme.textMuted, marginTop: 12 }}>Vehicle</Text>
          {vehicles.map((v) => (
            <Pressable
              key={v.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: v.id === vehicleId }}
              accessibilityLabel={v.name}
              onPress={() => setVehicleId(v.id)}
              style={[
                styles.button,
                {
                  borderColor: v.id === vehicleId ? theme.accent : theme.border,
                  backgroundColor: theme.card,
                  marginTop: 8,
                },
              ]}
            >
              <Text style={{ color: v.id === vehicleId ? theme.accent : theme.text }}>
                {v.name}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {ready && !running && vehicles.length === 1 && (
        <Text style={{ color: theme.textMuted, marginTop: 12 }}>Vehicle: {vehicles[0]!.name}</Text>
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
      {localConflict && (
        <>
          <Text accessibilityRole="alert" style={{ color: theme.text, marginTop: 12 }}>
            Another shift is already running on the server, so this phone's shift could not be sent.
            Its miles are still being recorded here.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => resolveConflict(false)}
            style={button}
          >
            <Text style={{ color: theme.accent }}>Keep this shift and try later</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => resolveConflict(true)}
            style={button}
          >
            <Text style={{ color: theme.accent }}>Continue the server shift instead</Text>
          </Pressable>
          <Text style={{ color: theme.textMuted }}>
            Continuing the server shift drops the miles recorded in this phone's own shift.
          </Text>
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
        onPress={() => navigation.navigate('Shifts')}
        style={button}
      >
        <Text style={{ color: theme.accent }}>Shifts</Text>
      </Pressable>
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
