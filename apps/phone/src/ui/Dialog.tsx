import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { Button } from '../components/ui/button';
import { Text } from '../components/ui/text';

export interface ConfirmInput {
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Red confirm button for things that cannot be undone from the phone. */
  destructive?: boolean;
}

type Confirm = (c: ConfirmInput) => Promise<boolean>;

const ConfirmContext = createContext<Confirm>(async () => false);

/** Asks before a step that is hard to undo; resolves true on confirm, false on cancel or back. */
export const useConfirm = () => useContext(ConfirmContext);

/** shadcn AlertDialog in the MileWage palette: scrim, card, title, description, two buttons. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<ConfirmInput | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<Confirm>(
    (c) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setOpen(c);
      }),
    [],
  );

  const close = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpen(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        visible={!!open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => close(false)}
      >
        <Pressable
          accessibilityLabel="Close"
          onPress={() => close(false)}
          className="flex-1 justify-center bg-black/70 px-6"
        >
          {open && (
            <Pressable
              accessibilityRole="alert"
              accessibilityViewIsModal
              onPress={() => undefined}
              className="gap-4 rounded-xl border border-border bg-card p-6"
            >
              <View className="gap-2">
                <Text variant="large">{open.title}</Text>
                {open.description && <Text variant="muted">{open.description}</Text>}
              </View>
              <View className="gap-2">
                <Button
                  variant={open.destructive ? 'destructive' : 'default'}
                  onPress={() => close(true)}
                >
                  <Text>{open.confirmLabel}</Text>
                </Button>
                <Button variant="outline" onPress={() => close(false)}>
                  <Text>{open.cancelLabel ?? 'Cancel'}</Text>
                </Button>
              </View>
            </Pressable>
          )}
        </Pressable>
      </Modal>
    </ConfirmContext.Provider>
  );
}
