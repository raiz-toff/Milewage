import * as React from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { cva, type VariantProps } from 'class-variance-authority';
import { ChevronRight } from 'lucide-react-native';
import { cn } from '../../lib/utils';
import { PALETTE } from '../../theme/colors';
import { Text } from './text';

// A swipe-to-confirm in the shadcn Button's shape: the same 56 dp height and rounded-lg corners as
// a large Button, so it sits where the Start shift button sat. The knob is a Button-coloured square.
const knobVariants = cva('flex-1 items-center justify-center rounded-md', {
  variants: {
    variant: { default: 'bg-primary', destructive: 'bg-destructive' },
  },
  defaultVariants: { variant: 'default' },
});

const fillVariants = cva('flex-1 rounded-md', {
  variants: {
    variant: { default: 'bg-primary/15', destructive: 'bg-destructive/15' },
  },
  defaultVariants: { variant: 'default' },
});

/** How far, as a share of the track, the knob must travel to count. */
const THRESHOLD = 0.85;
/** A quick flick past halfway counts too. */
const FLICK_SPEED = 900;
const SPRING = { damping: 20, stiffness: 220 };

type SwipeButtonProps = VariantProps<typeof knobVariants> & {
  /** Text shown in the track. */
  label: string;
  /** What a screen reader announces; it is also the double-tap action. */
  accessibilityLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
};

/**
 * Swipe the knob to the end to confirm, so a knock in a moving car cannot trigger it. Screen readers
 * get a single action instead, since they cannot swipe.
 *
 * Everything the gesture reads lives in shared values on the UI thread (the track size, whether it
 * already fired), and `onConfirm` is reached through a ref, so the gesture never acts on an old
 * width or an old callback. After it fires, the knob springs back by itself, so a confirm the
 * screen refuses (a bad odometer reading, say) never leaves it stuck at the end.
 */
function SwipeButton({
  label,
  accessibilityLabel,
  onConfirm,
  variant,
  disabled,
  className,
}: SwipeButtonProps) {
  const confirmRef = React.useRef(onConfirm);
  confirmRef.current = onConfirm;
  const confirm = React.useCallback(() => confirmRef.current(), []);

  const x = useSharedValue(0);
  const travel = useSharedValue(0); // track width minus the knob
  const knob = useSharedValue(0); // the knob is square: the inner track height
  const fired = useSharedValue(false);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    knob.value = height;
    travel.value = Math.max(0, width - height);
  };

  const config = React.useMemo(
    () => ({
      enabled: !disabled,
      // Start only on a sideways drag; a vertical brush fails the gesture instead.
      activeOffsetX: [-12, 12] as [number, number],
      failOffsetY: [-24, 24] as [number, number],
      hitSlop: { top: 8, bottom: 8, left: 8, right: 8 },
      onUpdate: (e: { translationX: number }) => {
        'worklet';
        if (fired.value) return;
        x.value = Math.min(Math.max(e.translationX, 0), travel.value);
      },
      onDeactivate: (e: { velocityX: number; canceled: boolean }) => {
        'worklet';
        if (fired.value) return;
        const max = travel.value;
        const reached = x.value >= max * THRESHOLD;
        const flicked = x.value >= max * 0.5 && e.velocityX > FLICK_SPEED;
        if (!e.canceled && max > 0 && (reached || flicked)) {
          fired.value = true;
          x.value = withTiming(max, { duration: 120 }, (done) => {
            if (!done) return;
            scheduleOnRN(confirm);
            x.value = withDelay(
              700,
              withSpring(0, SPRING, () => (fired.value = false)),
            );
          });
        } else {
          x.value = withSpring(0, SPRING);
        }
      },
    }),
    [disabled, confirm, fired, travel, x],
  );
  const pan = usePanGesture(config);

  const knobStyle = useAnimatedStyle(() => ({
    width: knob.value,
    transform: [{ translateX: x.value }],
  }));
  const fillStyle = useAnimatedStyle(() => ({ width: x.value + knob.value }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: travel.value > 0 ? Math.max(0, 1 - (x.value / travel.value) * 1.6) : 1,
  }));

  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={`Swipe right to ${accessibilityLabel.toLowerCase()}`}
      accessibilityState={{ disabled: !!disabled }}
      accessibilityActions={[{ name: 'activate', label: accessibilityLabel }]}
      onAccessibilityAction={(e) => {
        if (!disabled && e.nativeEvent.actionName === 'activate') onConfirm();
      }}
      className={cn(
        'h-14 rounded-lg border border-border bg-secondary p-1',
        disabled && 'opacity-50',
        className,
      )}
    >
      <View className="flex-1 justify-center" onLayout={onLayout}>
        <Animated.View
          pointerEvents="none"
          style={[{ position: 'absolute', top: 0, bottom: 0, left: 0 }, fillStyle]}
        >
          <View className={fillVariants({ variant })} />
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[{ position: 'absolute', left: 0, right: 0, alignItems: 'center' }, labelStyle]}
        >
          <Text variant="label" className="text-muted-foreground">
            {label}
          </Text>
        </Animated.View>
        <GestureDetector gesture={pan}>
          <Animated.View style={[{ height: '100%' }, knobStyle]}>
            <View className={knobVariants({ variant })}>
              <ChevronRight size={24} color={PALETTE.primaryForeground} strokeWidth={2.5} />
            </View>
          </Animated.View>
        </GestureDetector>
      </View>
    </View>
  );
}

export { SwipeButton };
export type { SwipeButtonProps };
