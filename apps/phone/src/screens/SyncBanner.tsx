import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useServices } from '../services';
import { reminderFor, type SyncStatus } from '../sync/status';
import { useTheme } from '../theme/theme';

const DAY = 86_400_000;
const K_REMINDER = 'reminder.lastShownAt';

/**
 * The one banner on the home screen (15 section 4.3, 4.4): what is not on the server yet, the
 * colour state, any red-state sentence, and the unsynced reminder (3 days, then daily, stronger
 * from 7). The reminder is shown here only: an operating-system notification adapter is not wired.
 */
export function SyncBanner({ onSettings }: { onSettings: () => void }) {
  const theme = useTheme();
  const { status, sync, monitor, plain, shift, uploader, runner } = useServices();
  const [s, setS] = useState<SyncStatus | null>(null);
  const [reminder, setReminder] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const next = await status();
    setS(next);
    const state = await plain.get(K_REMINDER);
    const now = Date.now();
    const r = reminderFor(next.oldestAt, next.unsyncedShifts, now, state ? Number(state) : null);
    if (r.level !== 'none') {
      await plain.set(K_REMINDER, String(now));
      setReminder(r.text);
    }
  }, [status, plain]);

  useEffect(() => {
    void refresh();
    return sync.subscribe(() => void refresh());
  }, [sync, refresh]);

  if (!s) return null;
  const colour = { green: theme.accent, yellow: theme.text, red: theme.text }[s.color];
  const days = s.oldestAt === null ? 0 : Math.floor((Date.now() - s.oldestAt) / DAY);
  const wrong = monitor.wrongServer;
  return (
    <View accessibilityLabel={`Sync status ${s.color}`} style={{ marginTop: 12 }}>
      <Text style={{ color: colour }}>
        {s.unsyncedShifts === 0
          ? 'Everything is on the server.'
          : `Not yet on server: ${s.unsyncedShifts} ${s.unsyncedShifts === 1 ? 'shift' : 'shifts'} · ${s.unsyncedPoints} points · oldest ${days} days ago`}
      </Text>
      {s.message && (
        <Text accessibilityRole="alert" style={{ color: theme.text }}>
          {s.message}
        </Text>
      )}
      {reminder !== '' && <Text style={{ color: theme.text }}>{reminder}</Text>}
      {wrong && (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              monitor.clearWrongServer();
              void refresh();
            }}
          >
            <Text style={{ color: theme.accent }}>Check the address</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onSettings}>
            <Text style={{ color: theme.accent }}>Re-pair to the new server</Text>
          </Pressable>
        </>
      )}
      {s.unsyncedShifts > 0 && !wrong && (
        <Pressable
          accessibilityRole="button"
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
          <Text style={{ color: theme.accent }}>Sync now</Text>
        </Pressable>
      )}
    </View>
  );
}
