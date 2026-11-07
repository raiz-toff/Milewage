import * as React from 'react';
import { Text } from './text';
import { cn } from '../../lib/utils';

/** shadcn/ui Label. */
function Label({ className, ...props }: React.ComponentProps<typeof Text>) {
  return <Text className={cn('font-sans-medium text-sm leading-none', className)} {...props} />;
}

export { Label };
