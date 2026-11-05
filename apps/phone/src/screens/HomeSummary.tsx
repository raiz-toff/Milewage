import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { formatDistance } from '../format';
import { deriveFlags } from '../pairing/pairing';
import { useServices } from '../services';
import { localDate } from '../store/shiftStore';
import { summarize, type HomeSummary as Summary, type PeriodSummary } from '../store/summary';
import { useTheme } from '../theme/theme';

function money(cents: number | null, currency: string): string {
  if (cents === null) return 'not available';
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** This week and this month from the shifts on the phone: distance and deduction value. Works offline. */
export function HomeSummary({ refreshKey }: { refreshKey?: unknown }) {
  const theme = useTheme();
  const { shifts, pairing } = useServices();
  const [data, setData] = useState<{ s: Summary; unit: 'km' | 'mi'; currency: string } | null>(
    null,
  );

  useEffect(() => {
    void (async () => {
      const state = await pairing.load();
      if (!state?.settings) return;
      const flags = deriveFlags(state.settings);
      setData({
        s: summarize(await shifts.list(5000), {
          today: localDate(Date.now(), flags.timezone),
          country: state.settings.country,
          vehicleKinds: await shifts.vehicleKinds(),
        }),
        unit: flags.distanceUnit,
        currency: state.settings.currency,
      });
    })();
  }, [shifts, pairing, refreshKey]);

  if (!data) return null;
  const line = (label: string, p: PeriodSummary) => (
    <Text style={{ color: theme.text }}>
      {label}: {formatDistance(p.totalM, data.unit)} · deduction value{' '}
      {money(p.deductionCents, data.currency)}
      {p.unsynced > 0
        ? ` (includes ${p.unsynced} ${p.unsynced === 1 ? 'shift' : 'shifts'} not yet on the server)`
        : ''}
    </Text>
  );
  return (
    <View accessibilityLabel="Summary" style={{ marginTop: 12 }}>
      {line('This week', data.s.week)}
      {line('This month', data.s.month)}
    </View>
  );
}
