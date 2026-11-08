import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Link2, XCircle } from 'lucide-react-native';
import { ApiError } from '../api/client';
import { addressProblem, explainFailure, type Failure } from '../connect/reach';
import { Alert, AlertTitle } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Text } from '../components/ui/text';
import type { ScreenProps } from '../navigation';
import { parsePairingPayload } from '../pairing/pairing';
import { useServices } from '../services';
import { useColors } from '../theme/theme';
import { useConfirm } from '../ui/Dialog';
import { Field } from '../ui/Field';
import { Screen } from '../ui/Screen';
import { useToast } from '../ui/Toast';

/**
 * Connect this phone to the driver's server (24 section 4.2, screen 4), in three ways: scan the
 * code, open the link on this phone, or paste the code. Connecting switches to the app screens.
 */
export function ConnectScreen({ navigation, route }: ScreenProps<'Connect'>) {
  const C = useColors();
  const { pairing, uploader, net, scanner: Scanner } = useServices();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const toast = useToast();
  const confirm = useConfirm();

  const submit = async (input: string) => {
    if (busy) return;
    const payload = parsePairingPayload(input.trim());
    if (!payload) return setError({ text: 'That is not a MileWage pairing code.' });
    const bad = addressProblem(payload.baseUrl, !__DEV__);
    if (bad) return setError({ text: bad });
    setError(null);
    setBusy(true);
    try {
      await pairing.redeem(payload);
      uploader.resume();
      setText('');
      toast.show({
        tone: 'success',
        title: 'Phone connected.',
        description: `Shifts will be sent to ${payload.baseUrl}.`,
      });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'unknown';
      const vpn = code === 'network' ? await net.vpnActive() : null;
      setError(explainFailure(code, payload.baseUrl, vpn));
    } finally {
      setBusy(false);
    }
  };

  // A link that opened the app (the phone's camera, or "Open in the MileWage app" on the web).
  // Anyone can make such a link, so the driver confirms the server first.
  const pairLink = route.params?.pairLink;
  useEffect(() => {
    if (!pairLink) return;
    navigation.setParams({ pairLink: undefined });
    void (async () => {
      const payload = parsePairingPayload(pairLink);
      if (!payload) {
        return toast.show({
          tone: 'error',
          title: 'That is not a MileWage pairing code.',
          description: 'Make a new code on the Devices page of the web app and scan it again.',
        });
      }
      const state = (await pairing.status()) === 'paired' ? await pairing.load() : null;
      if (state) {
        return toast.show({
          tone: 'error',
          title: 'This phone is already connected.',
          description: `It sends shifts to ${state.credential.baseUrl}. To change, open Settings, then Connect to a different server.`,
        });
      }
      const ok = await confirm({
        title: 'Connect to this server?',
        description: `${payload.baseUrl}\n\nShifts you record on this phone will be sent there. Only connect to your own MileWage server.`,
        confirmLabel: 'Yes, connect',
      });
      if (ok) await submit(pairLink);
    })();
    // Runs once per link; `submit` and the rest are read as they are when it arrives.
  }, [pairLink]);

  return (
    <Screen
      title="Connect to your server"
      description="On your computer, open MileWage, then Devices and Pair a phone."
    >
      {Scanner && (
        <Card>
          <CardHeader>
            <CardTitle>Scan the code</CardTitle>
            <CardDescription>Point this phone at the code on your computer screen.</CardDescription>
          </CardHeader>
          <CardContent>
            <Scanner busy={busy} onScanned={(t) => void submit(t)} />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="flex-row items-start gap-3">
          <Link2 size={18} color={C.foreground} />
          <View className="flex-1 gap-1">
            <CardTitle>Open the link</CardTitle>
            <CardDescription>
              Using MileWage in this phone's browser? Make the code there and tap Open in the
              MileWage app.
            </CardDescription>
          </View>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Paste the code</CardTitle>
          <CardDescription>Copy the code text under the QR code and paste it here.</CardDescription>
        </CardHeader>
        <CardContent>
          <Field
            accessibilityLabel="Pairing code"
            placeholder="milewage://pair?..."
            autoCapitalize="none"
            autoCorrect={false}
            value={text}
            onChangeText={(t) => {
              setText(t);
              setError(null);
            }}
            onSubmitEditing={() => void submit(text)}
            returnKeyType="go"
          />
          {error && (
            <Alert variant="destructive" icon={XCircle}>
              <AlertTitle accessibilityRole="alert">{error.text}</AlertTitle>
              {error.tailscale && (
                <Button variant="outline" size="sm" onPress={() => void net.openTailscale()}>
                  <Text>Open Tailscale</Text>
                </Button>
              )}
            </Alert>
          )}
          <Button
            variant={Scanner ? 'outline' : 'default'}
            disabled={busy || text.trim() === ''}
            onPress={() => void submit(text)}
          >
            <Text>{busy ? 'Connecting…' : 'Connect'}</Text>
          </Button>
        </CardContent>
      </Card>
    </Screen>
  );
}
