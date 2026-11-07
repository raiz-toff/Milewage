import * as React from 'react';
import { View } from 'react-native';
import { cn } from '../../lib/utils';

/** shadcn/ui Separator: a 1 px border-coloured rule. */
function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: React.ComponentProps<typeof View> & {
  className?: string;
  orientation?: 'horizontal' | 'vertical';
}) {
  return (
    <View
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
