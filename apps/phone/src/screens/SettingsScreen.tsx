import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ChevronRight, Cpu, MapPin, ShieldCheck, XCircle } from 'lucide-react-native';
import { version } from '../../package.json'; // kept equal to VERSION by version:check
import { Alert, AlertTitle } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Separator } from '../components/ui/separator';
import { Text } from '../components/ui/text';
import type { ScreenProps } from '../navigation';
import { addressesOf } from '../connect/route';
import { deriveFlags, type Credential, type PairedState } from '../pairing/pairing';
import { useServices } from '../services';
import { useColors } from '../theme/theme';
import { useConfirm } from '../ui/Dialog';
import { useToast } from '../ui/Toast';
import { ListRow, Rows, type IconType } from '../ui/Parts';
import { Screen } from '../ui/Screen';

export function SettingsScreen({ navigation }: ScreenProps<'Settings'>) {
  const C = useColors();
  const { pairing, diagnostics } = useServices();
  const [state, setState] = useState<PairedState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    void pairing.load().then(async (s) => {
      setState(s);
      if (s) {
        const r = await pairing.refreshSettings(s);
        setState(r.state);
        if (r.error?.status === 401)
          setError('Re-pair this phone: the server no longer accepts it.');
      }
    });
  }, [pairing]);

  const unpair = async () => {
    const ok = await confirm({
      title: 'Connect to a different server?',
      description: `This phone stops sending shifts to ${state?.credential.baseUrl}. Shifts not yet sent stay on this phone. Then connect to the new server.`,
      confirmLabel: 'Disconnect',
      destructive: true,
    });
    if (!ok) return;
    try {
      await pairing.unpair(); // the app start gate shows the first-run screens
      toast.show({ title: 'Phone disconnected.' });
    } catch {
      toast.show({ tone: 'error', title: 'Could not disconnect.', description: 'Try again.' });
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
      {state && (
        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <View className="flex-1 gap-1">
              <CardTitle>Server</CardTitle>
              <Addresses credential={state.credential} where={pairing.where} />
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
            <Button variant="outline" onPress={() => void unpair()}>
              <Text>Connect to a different server</Text>
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
        <Text variant="caption">{`MileWage ${version} · your data stays on your server`}</Text>
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

/** The server's two addresses (plan 28) and which one the phone uses now. */
function Addresses({
  credential,
  where,
}: {
  credential: Credential;
  where: 'home' | 'away' | null;
}) {
  const { home, away } = addressesOf(credential);
  const now = (w: 'home' | 'away') => (where === w ? ' (using now)' : '');
  return (
    <View className="gap-1">
      {home && <CardDescription>{`At home: ${home}${now('home')}`}</CardDescription>}
      {away ? (
        <CardDescription>{`Away: ${away}${now('away')}`}</CardDescription>
      ) : (
        <CardDescription>
          Away: not set up. Shifts are sent when the phone is on your home Wi-Fi.
        </CardDescription>
      )}
    </View>
  );
}
