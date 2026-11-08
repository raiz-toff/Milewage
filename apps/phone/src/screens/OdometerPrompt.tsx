import { useState } from 'react';
import { KeyboardAvoidingView, Modal, View } from 'react-native';
import { Button } from '../components/ui/button';
import { Text } from '../components/ui/text';
import { Field } from '../ui/Field';

/**
 * The once-in-a-while odometer check after a shift ends (Comma's "Quick audit" prompt, in the
 * MileWage dialog style). Save hands back the typed text; Not now and Back dismiss. Either way the
 * caller marks the check done, so the prompt stays away until the next one is due.
 */
export function OdometerPrompt({
  open,
  unit,
  onSave,
  onDismiss,
}: {
  open: boolean;
  unit: 'km' | 'mi';
  /** Resolves true when the reading was saved, false to keep the dialog open (a typing mistake). */
  onSave: (text: string) => Promise<boolean>;
  onDismiss: () => void;
}) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      if (await onSave(text)) setText('');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <KeyboardAvoidingView behavior="padding" className="flex-1 justify-center bg-black/70 px-6">
        <View
          accessibilityRole="alert"
          accessibilityViewIsModal
          className="gap-4 rounded-xl border border-border bg-card p-6"
        >
          <View className="gap-2">
            <Text variant="large">Odometer check</Text>
            <Text variant="muted">
              Type the reading on your dashboard. MileWage asks about twice a month, so your
              recorded miles can be checked against the car&apos;s.
            </Text>
          </View>
          <Field
            accessibilityLabel="Odometer reading"
            placeholder={`Reading in ${unit}, for example 45210`}
            keyboardType="decimal-pad"
            value={text}
            onChangeText={setText}
          />
          <View className="gap-2">
            <Button disabled={text.trim() === '' || saving} onPress={() => void save()}>
              <Text>Save reading</Text>
            </Button>
            <Button variant="outline" onPress={onDismiss}>
              <Text>Not now</Text>
            </Button>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
