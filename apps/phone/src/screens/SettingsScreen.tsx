import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ChevronRight, Cpu, MapPin, ShieldCheck, XCircle } from 'lucide-react-native';
import app from '../../app.json';
import { ApiError } from '../api/client';
import { Alert, AlertTitle } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Separator } from '../components/ui/separator';
import { Text } from '../components/ui/text';
import type { ScreenProps } from '../navigation';
import { deriveFlags, parsePairingPayload, type PairedState } from '../pairing/pairing';
import { useServices } from '../services';
import { useColors } from '../theme/theme';
import { useConfirm } from '../ui/Dialog';
import { Field } from '../ui/Field';
import { useToast } from '../ui/Toast';
import { ListRow, Rows, type IconType } from '../ui/Parts';
import { Screen } from '../ui/Screen';

const PROBLEMS: Record<string, string> = {
  invalid_pairing_token: 'This code is not valid, has expired or was already used. Make a new one.',
  rate_limited: 'Too many attempts. Wait a few minutes and try again.',
  network: 'Cannot reach the server. Check the address and your connection.',
};

export function SettingsScreen({ navigation, route }: ScreenProps<'Settings'>) {
  const C = useColors();
  const { pairing, uploader, diagnostics, scanner: Scanner } = useServices();
  const [state, setState] = useState<PairedState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Problems with the pairing form, shown inside it; `error` is for the paired state. */
  const [formError, setFormError] = useState<string | null>(null);
  const toast = useToast();
  const confirm = useConfirm();

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
    if (busy) return;
    const payload = parsePairingPayload(input.trim());
    if (!payload) {
      setFormError('That is not a MileWage pairing code.');
      return;
    }
    setFormError(null);
    setError(null);
    setBusy(true);
    try {
      const next = await pairing.redeem(payload);
      setState(next);
      uploader.resume();
      setText('');
      toast.show({
        tone: 'success',
        title: 'Phone paired.',
        description: `Shifts will be sent to ${payload.baseUrl}.`,
        action: { label: 'Go to home', onPress: () => navigation.navigate('Home') },
      });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'unknown';
      setFormError(PROBLEMS[code] ?? 'Pairing failed. Check the address and try again.');
    } finally {
      setBusy(false);
    }
  };

  // A pairing link that opened the app (the phone's camera, or a tap on the web page). Anyone can
  // make such a link, so the driver confirms the server before this phone sends shifts there.
  const pairLink = route.params?.pairLink;
  useEffect(() => {
    if (!loaded || !pairLink) return;
    navigation.setParams({ pairLink: undefined });
    const payload = parsePairingPayload(pairLink);
    if (!payload) {
      toast.show({
        tone: 'error',
        title: 'That is not a MileWage pairing code.',
        description: 'Make a new code on the Devices page of the web app and scan it again.',
      });
      return;
    }
    if (state) {
      toast.show({
        tone: 'error',
        title: 'This phone is already paired.',
        description: `It sends shifts to ${state.credential.baseUrl}. Unpair it first, then scan the new code.`,
      });
      return;
    }
    void confirm({
      title: 'Pair with this server?',
      description: `${payload.baseUrl}\n\nShifts you record on this phone will be sent there. Only pair with your own MileWage server.`,
      confirmLabel: 'Pair phone',
    }).then((ok) => {
      if (ok) void submit(pairLink);
    });
    // Runs once per link; `state`, `submit` and the rest are read as they are when it arrives.
  }, [loaded, pairLink]);

  const unpair = async () => {
    const ok = await confirm({
      title: 'Unpair this phone?',
      description:
        'Shifts not yet on the server stay on this phone, but nothing is sent until you pair again.',
      confirmLabel: 'Unpair',
      destructive: true,
    });
    if (!ok) return;
    try {
      await pairing.unpair();
      setState(null);
      toast.show({ title: 'Phone unpaired.' });
    } catch {
      toast.show({ tone: 'error', title: 'Could not unpair.', description: 'Try again.' });
    }
  };

  const flags = deriveFlags(state?.settings ?? null);

  return (
    <Screen title="Settings" description="This phone and the server it sends shifts to.">
      {error && (
        <Alert variant="destructive" icon={XCircle}>
          <AlertTitle accessibilityRole="alert">{error}</AlertTitle>
        </Alert>
      )}
      {!loaded ? null : state ? (
        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <View className="flex-1 gap-1">
              <CardTitle>Server</CardTitle>
              <CardDescription>Paired to {state.credential.baseUrl}</CardDescription>
            </View>
            <Badge variant={flags.tracking ? 'secondary' : 'outline'}>
              <Text>{flags.tracking ? 'Connected' : 'Tracking off'}</Text>
            </Badge>
          </CardHeader>
          <CardContent>
            {!flags.tracking && <Text variant="muted">Tracking is turned off on the server.</Text>}
            {flags.tracking && (
              <Text variant="muted">
                Distances in {flags.distanceUnit === 'mi' ? 'miles' : 'kilometres'}.
              </Text>
            )}
            {flags.stops && <Text variant="muted">Stops and the estimated split are on.</Text>}
            <Text variant="muted">
              Diagnostics: {state.settings ? diagnostics.effectiveLevel : 'unknown'} (set on the
              web), {diagnostics.size} waiting to send.
            </Text>
            <Separator />
            <Button variant="destructive" onPress={() => void unpair()}>
              <Text>Unpair this phone</Text>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Not paired.</CardTitle>
            <CardDescription>
              On the MileWage web app open Devices and make a pairing code, then scan it with this
              phone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {Scanner && <Scanner busy={busy} onScanned={(t) => void submit(t)} />}
            {Scanner && (
              <View className="flex-row items-center gap-3 py-1">
                <Separator className="flex-1" />
                <Text variant="caption">or paste the link</Text>
                <Separator className="flex-1" />
              </View>
            )}
            <Field
              accessibilityLabel="Pairing link"
              placeholder="milewage://pair?..."
              autoCapitalize="none"
              autoCorrect={false}
              value={text}
              onChangeText={(t) => {
                setText(t);
                setFormError(null);
              }}
              onSubmitEditing={() => void submit(text)}
              returnKeyType="go"
            />
            {formError && (
              <Alert variant="destructive" icon={XCircle}>
                <AlertTitle accessibilityRole="alert">{formError}</AlertTitle>
              </Alert>
            )}
            <Button
              variant={Scanner ? 'outline' : 'default'}
              disabled={busy || text.trim() === ''}
              onPress={() => void submit(text)}
            >
              <Text>{busy ? 'Pairing…' : 'Pair'}</Text>
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="py-0">
        <Rows>
          {[
            <Row
              key="perm"
              label="Permissions"
              detail="Location, activity, notifications, battery"
              icon={MapPin}
              onPress={() => navigation.navigate('Permissions')}
            />,
          ]}
        </Rows>
      </Card>

      <Text variant="caption" className="px-1 pt-2">
        Developer
      </Text>
      <Card className="py-0">
        <Rows>
          {[
            <Row
              key="engine"
              label="Engine check"
              detail="Check this phone counts miles exactly like the server"
              icon={Cpu}
              onPress={() => navigation.navigate('Conformance')}
            />,
          ]}
        </Rows>
      </Card>

      <View className="flex-row items-center justify-center gap-1.5 pt-2">
        <ShieldCheck size={12} color={C.mutedForeground} />
        <Text variant="caption">
          {`MileWage ${app.expo.version} · your data stays on your server`}
        </Text>
      </View>
    </Screen>
  );
}

function Row({
  label,
  detail,
  icon: Icon,
  onPress,
}: {
  label: string;
  detail: string;
  icon: IconType;
  onPress: () => void;
}) {
  const C = useColors();
  return (
    <ListRow accessibilityLabel={label} onPress={onPress}>
      <View className="h-9 w-9 items-center justify-center rounded-lg bg-muted">
        <Icon size={18} color={C.foreground} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text variant="label">{label}</Text>
        <Text variant="muted">{detail}</Text>
      </View>
      <ChevronRight size={18} color={C.mutedForeground} />
    </ListRow>
  );
}
