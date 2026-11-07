import type { ComponentProps } from 'react';
import { View } from 'react-native';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Text } from '../components/ui/text';

/** A labelled input with an optional hint, as the web forms lay them out. */
export function Field({
  label,
  hint,
  ...props
}: ComponentProps<typeof Input> & { label?: string; hint?: string }) {
  return (
    <View className="gap-2">
      {label && <Label>{label}</Label>}
      <Input {...props} />
      {hint && <Text variant="muted">{hint}</Text>}
    </View>
  );
}
