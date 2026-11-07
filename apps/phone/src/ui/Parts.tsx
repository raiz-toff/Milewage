import { useEffect, type ComponentType, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { cn } from '../lib/utils';

export type IconType = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

/** A small dot; `pulse` breathes it to say "recording now". */
export function Dot({ color, size = 8, pulse }: { color: string; size?: number; pulse?: boolean }) {
  const o = useSharedValue(1);
  useEffect(() => {
    if (!pulse) return;
    o.value = withRepeat(
      withSequence(withTiming(0.25, { duration: 900 }), withTiming(1, { duration: 900 })),
      -1,
    );
  }, [pulse, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View
      style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]}
    />
  );
}

/** A tappable row inside a card or list: 56 dp, accent on press. */
export function ListRow({
  onPress,
  accessibilityLabel,
  children,
  className,
}: {
  onPress?: () => void;
  accessibilityLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      className={cn(
        'min-h-[56px] flex-row items-center gap-3 px-4 py-3 active:bg-accent',
        className,
      )}
    >
      {children}
    </Pressable>
  );
}

/** Separates the rows of a card list with a border, as the web tables do. */
export function Rows({ children }: { children: ReactNode[] }) {
  return (
    <View>
      {children.map((child, i) => (
        <View key={i} className={i > 0 ? 'border-t border-border' : undefined}>
          {child}
        </View>
      ))}
    </View>
  );
}

/** A small label above a group of cards, like the web's section headings. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <View className="px-1 pt-2">{children}</View>;
}
