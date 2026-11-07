import { useCallback, useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { CheckCircle2 } from 'lucide-react-native';
import { Alert, AlertTitle } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Text } from '../components/ui/text';
import type { NetPort } from '../connect/reach';
import type { ScreenProps } from '../navigation';
import { useServices } from '../services';
import { Rows } from '../ui/Parts';
import { Screen } from '../ui/Screen';

/**
 * Where "I have a server" goes (24 section 4.2): straight to Connect, or first to the Tailscale
 * screen when the phone can tell Tailscale is missing or off. Unknown VPN state does not stop it.
 */
export async function connectRoute(net: NetPort): Promise<'Connect' | 'Tailscale'> {
  if (!(await net.tailscaleInstalled())) return 'Tailscale';
  return (await net.vpnActive()) === false ? 'Tailscale' : 'Connect';
}

const STEPS = [
  { title: 'Install Tailscale', detail: 'The free app from the Play Store.' },
  { title: 'Sign in', detail: 'With the same account as your server.' },
  { title: 'Turn it on', detail: 'Connect in Tailscale, then come back here.' },
];

/** Get Tailscale on this phone (24 section 4.2, screen 3). Skippable: other https routes work. */
export function TailscaleScreen({ navigation }: ScreenProps<'Tailscale'>) {
  const { net } = useServices();
  const [state, setState] = useState<{ installed: boolean; on: boolean | null } | null>(null);

  const read = useCallback(async () => {
    setState({ installed: await net.tailscaleInstalled(), on: await net.vpnActive() });
  }, [net]);
  useEffect(() => {
    void read();
    // Coming back from Tailscale or the Play Store: look again.
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void read());
    return () => sub.remove();
  }, [read]);

  const ready = !!state?.installed && state.on === true;
  return (
    <Screen
      title="Get Tailscale on this phone"
      description="Tailscale lets this phone reach your server from anywhere, on Wi-Fi or mobile data."
      footer={
        <View className="gap-3">
          <Button size="lg" onPress={() => navigation.navigate('Connect')}>
            <Text>{ready ? 'Continue' : 'Continue without Tailscale'}</Text>
          </Button>
        </View>
      }
    >
      <Card className="py-0">
        <Rows>
          {STEPS.map((s, i) => (
            <View key={s.title} className="flex-row items-start gap-3 px-4 py-3">
              <View className="h-7 w-7 items-center justify-center rounded-full bg-muted">
                <Text variant="label" tabular>
                  {i + 1}
                </Text>
              </View>
              <View className="flex-1 gap-0.5">
                <Text variant="label">{s.title}</Text>
                <Text variant="muted">{s.detail}</Text>
              </View>
            </View>
          ))}
        </Rows>
      </Card>
      {ready ? (
        <Alert icon={CheckCircle2}>
          <AlertTitle accessibilityRole="alert">Tailscale is on. You can connect.</AlertTitle>
        </Alert>
      ) : (
        state && (
          <Button variant="secondary" onPress={() => void net.openTailscale()}>
            <Text>{state.installed ? 'Open Tailscale' : 'Install Tailscale'}</Text>
          </Button>
        )
      )}
      <Text variant="muted">
        Reaching your server another way, such as your own https address? Continue without
        Tailscale.
      </Text>
    </Screen>
  );
}
