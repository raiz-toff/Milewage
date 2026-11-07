import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AccessibilityInfo, Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react-native';
import { Button } from '../components/ui/button';
import { Text } from '../components/ui/text';
import { cn } from '../lib/utils';
import { useColors } from '../theme/theme';

export type ToastTone = 'default' | 'success' | 'error';

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** One follow-up, so a message is never a dead end ("Fix", "View shift", "Try again"). */
  action?: { label: string; onPress: () => void };
}

interface ToastApi {
  show: (t: ToastInput) => void;
  hide: () => void;
}

const ToastContext = createContext<ToastApi>({ show: () => undefined, hide: () => undefined });

/** Short messages come here instead of being pushed into the page, so nothing jumps. */
export const useToast = () => useContext(ToastContext);

const SHOW_MS = { default: 4000, success: 3500, error: 7000 } as const;
const ICON = { default: Info, success: CheckCircle2, error: AlertTriangle } as const;

/**
 * One toast at a time over the bottom of the screen, above the bottom bar. A new one replaces
 * the old. It is read out by screen readers, can be closed, and hides itself after a while;
 * errors and toasts with an action stay longer, so the follow-up can be reached.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const C = useColors();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<(ToastInput & { id: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const y = useSharedValue(0);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setToast(null);
  }, []);

  const show = useCallback(
    (t: ToastInput) => {
      if (timer.current) clearTimeout(timer.current);
      seq.current += 1;
      setToast({ ...t, id: seq.current });
      AccessibilityInfo.announceForAccessibility(
        t.description ? `${t.title}. ${t.description}` : t.title,
      );
      timer.current = setTimeout(hide, t.action ? 8000 : SHOW_MS[t.tone ?? 'default']);
    },
    [hide],
  );

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  useEffect(() => {
    y.value = 24;
    y.value = withTiming(0, { duration: 180 });
  }, [toast?.id, y]);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  const api = useMemo(() => ({ show, hide }), [show, hide]);
  const tone = toast?.tone ?? 'default';
  const Icon = ICON[tone];
  const iconColor =
    tone === 'error' ? C.destructive : tone === 'success' ? C.primary : C.foreground;

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast && (
        <Animated.View
          pointerEvents="box-none"
          style={[{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 96 }, slide]}
        >
          <View
            className={cn(
              'flex-row items-start gap-3 rounded-xl border bg-card p-4',
              tone === 'error' ? 'border-destructive/50' : 'border-border',
            )}
            style={{ elevation: 8 }}
          >
            <View className="pt-0.5">
              <Icon size={18} color={iconColor} strokeWidth={2.25} />
            </View>
            <View className="flex-1 gap-1">
              <Text variant="label">{toast.title}</Text>
              {toast.description && <Text variant="muted">{toast.description}</Text>}
              {toast.action && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 self-start"
                  onPress={() => {
                    const act = toast.action!.onPress;
                    hide();
                    act();
                  }}
                >
                  <Text>{toast.action.label}</Text>
                </Button>
              )}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close message"
              hitSlop={12}
              onPress={hide}
              className="h-8 w-8 items-center justify-center rounded-md active:bg-accent"
            >
              <X size={16} color={C.mutedForeground} />
            </Pressable>
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}
