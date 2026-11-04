import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput } from 'react-native';
import { ApiError } from '../api/client';
import type { ScreenProps } from '../navigation';
import { deriveFlags, parsePairingPayload, type PairedState } from '../pairing/pairing';
import { useServices } from '../services';
import { useTheme } from '../theme/theme';
import { Screen } from './Screen';

const PROBLEMS: Record<string, string> = {
  invalid_pairing_token: 'This code is not valid, has expired or was already used. Make a new one.',
  rate_limited: 'Too many attempts. Wait a few minutes and try again.',
  network: 'Cannot reach the server. Check the address and your connection.',
};

export function SettingsScreen({ navigation }: ScreenProps<'Settings'>) {
  const theme = useTheme();
  const { pairing, uploader, scanner: Scanner } = useServices();
  const [state, setState] = useState<PairedState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void pairing.load().then(async (s) => {
      setState(s);
      setLoaded(true);
      if (s) {
        const r = await pairing.refreshSettings(s);
        setState(r.state);
        if (r.error?.status === 401)
          setError('Re-pair this phone: the server no longer accepts it.');
      }
    });
  }, [pairing]);

  const submit = async (input: string) => {
    const payload = parsePairingPayload(input);
    if (!payload) {
      setError('That is not a MileWage pairing code.');
      return;
    }
    setError(null);
    try {
      setState(await pairing.redeem(payload));
      uploader.resume();
      setText('');
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'unknown';
      setError(PROBLEMS[code] ?? 'Pairing failed.');
    }
  };

  const flags = deriveFlags(state?.settings ?? null);
  const muted = { color: theme.textMuted, marginTop: 8 };

  return (
    <Screen title="Settings">
      {!loaded ? null : state ? (
        <>
          <Text style={{ color: theme.text }}>Paired to {state.credential.baseUrl}</Text>
          {!flags.tracking && <Text style={muted}>Tracking is turned off on the server.</Text>}
          {flags.tracking && (
            <Text style={muted}>
              Distances in {flags.distanceUnit === 'mi' ? 'miles' : 'kilometres'}.
            </Text>
          )}
          {flags.stops && <Text style={muted}>Stops and the estimated split are on.</Text>}
          <Pressable
            accessibilityRole="button"
            onPress={async () => {
              await pairing.unpair();
              setState(null);
            }}
          >
            <Text style={{ color: theme.accent, marginTop: 16 }}>Unpair this phone</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={{ color: theme.textMuted }}>Not paired.</Text>
          {Scanner && <Scanner onScanned={(t) => void submit(t)} />}
          <TextInput
            accessibilityLabel="Pairing link"
            placeholder="milewage://pair?..."
            placeholderTextColor={theme.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            value={text}
            onChangeText={setText}
            style={{
              color: theme.text,
              borderColor: theme.border,
              borderWidth: 1,
              marginTop: 12,
              padding: 8,
            }}
          />
          <Pressable accessibilityRole="button" onPress={() => void submit(text)}>
            <Text style={{ color: theme.accent, marginTop: 12 }}>Pair</Text>
          </Pressable>
        </>
      )}
      {error && (
        <Text accessibilityRole="alert" style={{ color: theme.text, marginTop: 12 }}>
          {error}
        </Text>
      )}
      <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Permissions')}>
        <Text style={{ color: theme.accent, marginTop: 16 }}>Permissions</Text>
      </Pressable>
    </Screen>
  );
}
