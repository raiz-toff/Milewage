import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Card, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Text } from '../components/ui/text';
import { formatDistance } from '../format';
import { cn } from '../lib/utils';
import { deriveFlags } from '../pairing/pairing';
import { useServices } from '../services';
import { localDate } from '../store/shiftStore';
import { summarize, type HomeSummary as Summary } from '../store/summary';

export function money(cents: number | null, currency: string): string {
  if (cents === null) return 'not available';
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

const PERIOD = { W: 'week', M: 'month' } as const;

/**
 * This week or this month from the shifts on the phone: distance, shifts and deduction value, as
 * the web dashboard's metric cards. Works offline; unsynced shifts are counted and said so.
 */
export function HomeSummary({ refreshKey }: { refreshKey?: unknown }) {
  const { shifts, pairing } = useServices();
  const [tab, setTab] = useState<keyof typeof PERIOD>('W');
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
  const name = PERIOD[tab];
  const p = data.s[name];
  return (
    <View accessibilityLabel="Summary" className="gap-3">
      {/* shadcn Tabs list: muted track, the active tab raised on the background. */}
      <View accessibilityRole="tablist" className="flex-row rounded-lg bg-muted p-1">
        {(['W', 'M'] as const).map((t) => (
          <Pressable
            key={t}
            accessibilityRole="tab"
            accessibilityLabel={`This ${PERIOD[t]}`}
            accessibilityState={{ selected: tab === t }}
            onPress={() => setTab(t)}
            className={cn(
              'h-10 flex-1 items-center justify-center rounded-md',
              tab === t && 'border border-border bg-background',
            )}
          >
            <Text
              variant="label"
              className={tab === t ? 'text-foreground' : 'text-muted-foreground'}
            >
              {`This ${PERIOD[t]}`}
            </Text>
          </Pressable>
        ))}
      </View>
      <Card>
        <CardHeader>
          <CardDescription>Distance driven</CardDescription>
          <CardTitle
            tabular
            accessibilityLabel={`Distance this ${name}`}
            className="font-sans-semibold text-3xl tracking-tight"
          >
            {formatDistance(p.totalM, data.unit)}
          </CardTitle>
          {p.unsynced > 0 && (
            <Text variant="muted">
              {`This ${name} includes ${p.unsynced} ${p.unsynced === 1 ? 'shift' : 'shifts'} not yet on the server.`}
            </Text>
          )}
        </CardHeader>
      </Card>
      <View className="flex-row gap-3">
        <Metric label="Shifts" value={String(p.shifts)} />
        <Metric label="Deduction value" value={money(p.deductionCents, data.currency)} />
      </View>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card accessibilityLabel={`${label} ${value}`} className="flex-1">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle
          tabular
          numberOfLines={1}
          adjustsFontSizeToFit
          className="text-xl font-sans-semibold"
        >
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}
