import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { AlertTriangle, CloudCheck, CloudOff } from 'lucide-react-native';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Text } from '../components/ui/text';
import { isTailnetAddress } from '../connect/reach';
import { useServices } from '../services';
import { reminderFor, type SyncStatus } from '../sync/status';
import { useColors } from '../theme/theme';

const DAY = 86_400_000;
const K_REMINDER = 'reminder.lastShownAt';
const HINT_AFTER_MS = 10 * 60_000;

/**
 * The one sync notice on the home screen (15 section 4.3, 4.4): what is not on the server yet,
 * any red-state sentence, and the unsynced reminder (3 days, then daily, stronger from 7).
 * All synced is one quiet line; anything waiting is an alert.
 */
export function SyncBanner({ onSettings }: { onSettings: () => void }) {
  const C = useColors();
  const { status, sync, monitor, plain, shift, uploader, runner, pairing, net } = useServices();
  const [s, setS] = useState<SyncStatus | null>(null);
  const [reminder, setReminder] = useState('');
  const [busy, setBusy] = useState(false);
  /** Plan 19 section 3.5: something waiting 10 minutes for a `.ts.net` server, no VPN on. */
  const [tailscaleOff, setTailscaleOff] = useState(false);

  const refresh = useCallback(async () => {
    const next = await status();
    setS(next);
    const state = await plain.get(K_REMINDER);
    const now = Date.now();
    const base = (await pairing.load())?.credential.baseUrl ?? '';
    const waited = next.oldestAt !== null && now - next.oldestAt >= HINT_AFTER_MS;
    // With no VPN a tailnet address cannot be reached at all, so no failed upload is needed.
    setTailscaleOff(waited && isTailnetAddress(base) && (await net.vpnActive()) === false);
    const r = reminderFor(next.oldestAt, next.unsyncedShifts, now, state ? Number(state) : null);
    if (r.level !== 'none') {
      await plain.set(K_REMINDER, String(now));
      setReminder(r.text);
    }
  }, [status, plain, pairing, net]);

  useEffect(() => {
    void refresh();
    return sync.subscribe(() => void refresh());
  }, [sync, refresh]);

  if (!s) return null;
  const days = s.oldestAt === null ? 0 : Math.floor((Date.now() - s.oldestAt) / DAY);
  const wrong = monitor.wrongServer;
  const label = `Sync status ${s.color}`;

  if (s.color === 'green' && s.unsyncedShifts === 0 && !s.message && !wrong && reminder === '') {
    return (
      <View accessibilityLabel={label} className="flex-row items-center justify-center gap-2">
        <CloudCheck size={14} color={C.mutedForeground} />
        <Text variant="muted">Everything is on the server.</Text>
      </View>
    );
  }

  return (
    <Alert
      accessibilityLabel={label}
      variant={s.color === 'red' ? 'destructive' : 'default'}
      icon={s.color === 'red' ? AlertTriangle : CloudOff}
    >
      <AlertTitle>
        {s.unsyncedShifts === 0
          ? 'Everything is on the server.'
          : `Not yet on server: ${s.unsyncedShifts} ${s.unsyncedShifts === 1 ? 'shift' : 'shifts'} · ${s.unsyncedPoints} points · oldest ${days} days ago`}
      </AlertTitle>
      {s.message && <AlertDescription accessibilityRole="alert">{s.message}</AlertDescription>}
      {reminder !== '' && <AlertDescription>{reminder}</AlertDescription>}
      {tailscaleOff && (
        <View className="gap-2 pt-1">
          <AlertDescription>
            Tailscale is off on this phone, so your server cannot be reached.
          </AlertDescription>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onPress={() => void net.openTailscale()}
          >
            <Text>Open Tailscale</Text>
          </Button>
        </View>
      )}
      {wrong && (
        <View className="flex-row flex-wrap gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onPress={() => {
              monitor.clearWrongServer();
              void refresh();
            }}
          >
            <Text>Check the address</Text>
          </Button>
          <Button variant="outline" size="sm" onPress={onSettings}>
            <Text>Re-pair to the new server</Text>
          </Button>
        </View>
      )}
      {s.unsyncedShifts > 0 && !wrong && (
        <Button
          variant="outline"
          size="sm"
          className="mt-1 self-start"
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            uploader.resume();
            runner.resume();
            await shift.sync();
            await sync.drain();
            setBusy(false);
            await refresh();
          }}
        >
          <Text>{busy ? 'Sending…' : 'Sync now'}</Text>
        </Button>
      )}
    </Alert>
  );
}
