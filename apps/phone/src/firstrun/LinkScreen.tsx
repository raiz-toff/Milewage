import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { XCircle } from 'lucide-react-native';
import { ApiError } from '../api/client';
import { Alert, AlertTitle } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription } from '../components/ui/card';
import { Text } from '../components/ui/text';
import type { ScreenProps } from '../navigation';
import type { LinkStart } from '../pairing/pairing';
import { useServices } from '../services';
import { useColors } from '../theme/theme';
import { Screen } from '../ui/Screen';
import { useToast } from '../ui/Toast';

type State =
  { kind: 'asking' } | { kind: 'waiting'; link: LinkStart } | { kind: 'failed'; text: string };

const MESSAGES: Record<string, string> = {
  link_expired: 'The code expired or was refused. Get a new code and try again.',
  rate_limited: 'Too many phones are waiting to link. Wait a minute and try again.',
  network: "Can't reach your server. Check that this phone is on the same Wi-Fi as the server.",
  not_found: 'This server cannot link phones with a code yet. Update it, or scan the code.',
};

/**
 * Link this phone to a server found on the Wi-Fi (plan 28 section 4.5): the phone asks, shows a
 * 6-digit code, and waits while the driver types it on the web (RFC 8628's device flow). Once
 * linked, the app shows the Connected step by itself (the pairing changed).
 */
export function LinkScreen({ navigation, route }: ScreenProps<'Link'>) {
  const C = useColors();
  const { pairing } = useServices();
  const toast = useToast();
  const { url, name } = route.params;
  const [state, setState] = useState<State>({ kind: 'asking' });
  const [attempt, setAttempt] = useState(0);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = (e: unknown) => {
      const code = e instanceof ApiError ? e.code : 'unknown';
      if (live.current) {
        setState({ kind: 'failed', text: MESSAGES[code] ?? 'Linking failed. Try again.' });
      }
    };
    const poll = (link: LinkStart, waitMs: number, misses: number) => {
      timer = setTimeout(async () => {
        if (!live.current) return;
        if (Date.now() > link.expiresAt) return fail(new ApiError(410, 'link_expired', false));
        try {
          const done = await pairing.pollLink(url, link.deviceCode);
          if (!live.current) return;
          if (!done) return poll(link, link.intervalMs, 0); // pairing lifts every halt
          toast.show({
            tone: 'success',
            title: 'Phone connected.',
            description: `Shifts will be sent to ${url}.`,
          });
        } catch (e) {
          const code = e instanceof ApiError ? e.code : 'unknown';
          // RFC 8628 section 3.5: slow down by 5 s; a lost answer is tried again, more slowly.
          if (code === 'slow_down') return poll(link, waitMs + 5000, misses);
          if (code === 'network' && misses < 5) return poll(link, waitMs * 2, misses + 1);
          fail(e);
        }
      }, waitMs);
    };
    setState({ kind: 'asking' });
    pairing.startLink(url).then((link) => {
      if (!live.current) return;
      setState({ kind: 'waiting', link });
      poll(link, link.intervalMs, 0);
    }, fail);
    return () => {
      live.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [url, attempt, pairing, toast]);

  const code = state.kind === 'waiting' ? state.link.userCode : null;
  return (
    <Screen
      title="Link this phone"
      description={`${name} · ${url}`}
      footer={
        <Button size="lg" variant="outline" onPress={() => navigation.goBack()}>
          <Text>Cancel</Text>
        </Button>
      }
    >
      {state.kind === 'failed' ? (
        <Alert variant="destructive" icon={XCircle}>
          <AlertTitle accessibilityRole="alert">{state.text}</AlertTitle>
          <Button variant="outline" size="sm" onPress={() => setAttempt((n) => n + 1)}>
            <Text>Get a new code</Text>
          </Button>
        </Alert>
      ) : (
        <Card>
          <CardContent className="gap-4">
            <CardDescription>
              On your computer, open MileWage, then Devices (or the setup step Pair your phone), and
              type this code:
            </CardDescription>
            {code ? (
              <Text
                accessibilityLabel={`Code ${code.split('').join(' ')}`}
                className="text-center font-mono text-4xl font-semibold tracking-widest"
              >
                {`${code.slice(0, 3)} ${code.slice(3)}`}
              </Text>
            ) : null}
            <View className="flex-row items-center justify-center gap-2">
              <ActivityIndicator color={C.mutedForeground} />
              <Text className="text-muted-foreground">
                {code ? 'Waiting for your computer…' : 'Asking your server…'}
              </Text>
            </View>
          </CardContent>
        </Card>
      )}
    </Screen>
  );
}
