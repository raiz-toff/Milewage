import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { CloudCheck, CloudUpload, Square } from 'lucide-react-native';
import { Button } from '../components/ui/button';
import { Text } from '../components/ui/text';
import { M_PER_UNIT, formatClock } from '../format';
import { useServices } from '../services';
import type { ActiveShift } from '../shift/controller';
import { localDate } from '../store/shiftStore';
import { runningValue } from '../store/summary';
import { useColors } from '../theme/theme';
import { useConfirm } from '../ui/Dialog';
import { Screen } from '../ui/Screen';
import { money } from './HomeSummary';

/** "1:04:09" from milliseconds. */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
}

/** Material 3's indeterminate linear progress: a segment that keeps sliding means "recording". */
function LiveBar({ color }: { color: string }) {
  const [width, setWidth] = useState(0);
  const x = useSharedValue(0);
  useEffect(() => {
    x.value = withRepeat(withTiming(1, { duration: 1600 }), -1);
  }, [x]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: -0.35 * width + x.value * 1.35 * width }],
  }));
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      className="h-1 overflow-hidden bg-secondary"
    >
      <Animated.View style={[{ width: width * 0.35, height: 4, backgroundColor: color }, style]} />
    </View>
  );
}

/** One instrument reading: a small capital label over a large tabular figure. */
function Reading(p: {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  size: number;
  className?: string;
}) {
  return (
    <View
      accessible
      accessibilityLabel={p.label}
      accessibilityValue={{ text: p.unit ? `${p.value} ${p.unit}` : p.value }}
      className="gap-1 border-b border-border py-5"
    >
      <Text variant="caption" className="uppercase tracking-widest">
        {p.label}
      </Text>
      <View className="flex-row items-baseline gap-2">
        <Text
          tabular
          numberOfLines={1}
          adjustsFontSizeToFit
          className={`font-sans-semibold tracking-tight ${p.className ?? ''}`}
          style={{ fontSize: p.size, lineHeight: p.size * 1.15 }}
        >
          {p.value}
        </Text>
        {p.unit && <Text className="font-sans-medium text-xl text-muted-foreground">{p.unit}</Text>}
      </View>
      {p.note && <Text variant="muted">{p.note}</Text>}
    </View>
  );
}

/**
 * The screen while a shift records: three readings, largest first (time, distance, deduction
 * value so far), whether the shift is on the server, and one End shift button that asks first.
 */
export function RunningShift(p: {
  shift: ActiveShift;
  meters: number;
  now: number;
  zone: string;
  unit: 'km' | 'mi';
  vehicle?: string;
  ending: boolean;
  onEnd: () => void;
  nav: ReactNode;
  /** Notices and the sync banner, under the readings. */
  children?: ReactNode;
}) {
  const { shift, meters, now, zone, unit, vehicle, ending, onEnd, nav, children } = p;
  const C = useColors();
  const confirm = useConfirm();
  const { shifts, pairing } = useServices();
  const [price, setPrice] = useState<{
    of: (totalM: number) => number | null;
    currency: string;
    yours: boolean;
  } | null>(null);

  // The shifts before this one are fixed while it runs: read them once.
  useEffect(() => {
    let live = true;
    void (async () => {
      const s = (await pairing.load())?.settings;
      if (!s) return;
      const rows = await shifts.list(5000);
      const own = s.own_mileage_rate;
      const opts = {
        country: s.country,
        vehicleKinds: await shifts.vehicleKinds(),
        ownRate: own ? { centsPerUnit: own.cents_per_unit, unit: own.unit } : null,
      };
      const at = { date: localDate(shift.startedAt, zone), startedAt: shift.startedAt };
      const of = (totalM: number) =>
        runningValue(rows, opts, { ...at, totalM, vehicleId: shift.vehicleId });
      if (live) setPrice({ of, currency: s.currency, yours: s.mileage_rate === 'yours' });
    })();
    return () => {
      live = false;
    };
  }, [shifts, pairing, shift.startedAt, shift.vehicleId, zone]);

  const value = price?.of(meters);
  const Cloud = shift.created ? CloudCheck : CloudUpload;
  const distance = (meters / M_PER_UNIT[unit]).toFixed(1);

  const askEnd = async () => {
    const ok = await confirm({
      title: 'End this shift?',
      description: `Recording stops at ${distance} ${unit}. You cannot restart this shift.`,
      confirmLabel: 'End shift',
      cancelLabel: 'Keep recording',
      destructive: true,
    });
    if (ok) onEnd();
  };

  return (
    <Screen
      title="Shift running"
      header={
        <View>
          <View className="flex-row items-center justify-between px-4 pb-3 pt-2">
            <View className="flex-1 gap-0.5">
              <Text variant="h4" accessibilityRole="header">
                Shift running
              </Text>
              <Text variant="muted" numberOfLines={1}>
                {[vehicle, `since ${formatClock(shift.startedAt, zone)}`]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            {nav}
          </View>
          <LiveBar color={C.primary} />
        </View>
      }
      footer={
        <Button
          size="lg"
          variant="destructive"
          accessibilityLabel={ending ? 'Ending shift' : 'End shift'}
          disabled={ending}
          onPress={() => void askEnd()}
        >
          {ending ? (
            <ActivityIndicator color={C.background} />
          ) : (
            <Square size={16} color={C.background} fill={C.background} />
          )}
          <Text>{ending ? 'Ending shift…' : 'End shift'}</Text>
        </Button>
      }
    >
      <View>
        <Reading label="Time" value={elapsed(now - shift.startedAt)} size={64} />
        <Reading
          label="Distance"
          value={distance}
          unit={unit}
          size={48}
          note="Approximate; the server works out the final distance."
        />
        {value != null && price && (
          <Reading
            label={price.yours ? 'Deduction so far (your rate)' : 'Deduction so far'}
            value={money(value, price.currency)}
            size={36}
            className="text-earned"
          />
        )}
        <View className="flex-row items-center gap-2 py-4">
          <Cloud size={16} color={C.mutedForeground} />
          <Text variant="muted">
            {shift.created ? 'On the server' : 'Kept on this phone until the server is reachable'}
          </Text>
        </View>
      </View>
      {children}
    </Screen>
  );
}
