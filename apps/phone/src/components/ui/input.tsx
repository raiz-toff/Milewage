import * as React from 'react';
import { TextInput } from 'react-native';
import { cn } from '../../lib/utils';
import { useColors } from '../../theme/theme';

/** shadcn/ui Input: input-coloured border, background fill, rounded-lg, 48 dp tall. */
function Input({
  className,
  ...props
}: React.ComponentProps<typeof TextInput> & { className?: string }) {
  const C = useColors();
  return (
    <TextInput
      placeholderTextColor={C.mutedForeground}
      selectionColor={C.foreground}
      className={cn(
        'h-12 rounded-lg border border-input bg-background px-3 font-sans text-base text-foreground',
        props.editable === false && 'opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
