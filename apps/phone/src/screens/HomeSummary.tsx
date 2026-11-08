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

/** ISO 4217 currencies whose minor unit is not 2 digits (used when Intl cannot say). */
const MINOR_DIGITS: Record<string, number> = {
  ...Object.fromEntries(
    'BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX UYI VND VUV XAF XOF XPF'
      .split(' ')
      .map((c) => [c, 0]),
  ),
  ...Object.fromEntries('BHD IQD JOD KWD LYD OMR TND'.split(' ').map((c) => [c, 3])),
  CLF: 4,
  UYW: 4,
};

/** Amounts are in the currency's minor unit; its own number of digits says where the point goes. */
export function money(minor: number | null, currency: string): string {
  if (minor === null) return 'not available';
  try {
    const f = new Intl.NumberFormat('en', { style: 'currency', currency });
    return f.format(minor / 10 ** (f.resolvedOptions().maximumFractionDigits ?? 2));
  } catch {
    const digits = MINOR_DIGITS[currency.toUpperCase()] ?? 2;
    return `${(minor / 10 ** digits).toFixed(digits)} ${currency}`;
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
  const [data, setData] = useState<{
    s: Summary;
    unit: 'km' | 'mi';
    currency: string;
    yours: boolean;
  } | null>(null);

  useEffect(() => {
    void (async () => {
      const state = await pairing.load();
      if (!state?.settings) return;
      const flags = deriveFlags(state.settings);
      const own = state.settings.own_mileage_rate;
      setData({
        s: summarize(await shifts.list(5000), {
          today: localDate(Date.now(), flags.timezone),
          country: state.settings.country,
          vehicleKinds: await shifts.vehicleKinds(),
          ownRate: own && { centsPerUnit: own.cents_per_unit, unit: own.unit },
        }),
        unit: flags.distanceUnit,
        currency: state.settings.currency,
        yours: state.settings.mileage_rate === 'yours',
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
        <Metric
          // A value at the driver's own rate is never shown as an official one (plan 21 Q5).
          label={data.yours ? 'Deduction value (your rate)' : 'Deduction value'}
          value={money(p.deductionCents, data.currency)}
        />
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
