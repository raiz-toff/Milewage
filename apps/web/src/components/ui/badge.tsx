import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import { cn } from '@/lib/utils';

/**
 * A short label beside a name ("Default", "Reviewed", "Next"), drawn as a Material 3 chip
 * (m3.material.io/components/chips): small corners (8 px), label-medium text. Not interactive
 * unless it is a link (`asChild`), which then gets the state layer. `count` is Material's large
 * badge: the number on an icon (unread notifications), error colours, a 16 px pill.
 */
const badgeVariants = cva(
  'group/badge relative inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-small border border-transparent px-2 text-label-medium whitespace-nowrap transition-colors focus-ring has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive [a]:state-layer [&>svg]:pointer-events-none [&>svg]:size-3.5!',
  {
    variants: {
      variant: {
        default: 'bg-primary-container text-on-primary-container',
        secondary: 'bg-secondary-container text-on-secondary-container',
        destructive: 'bg-error-container text-on-error-container',
        outline: 'border-outline-variant text-on-surface-variant',
        ghost: 'text-on-surface-variant',
        link: 'text-primary underline-offset-4 hover:underline',
        count: 'h-4 min-w-4 rounded-full bg-error px-1 text-label-small text-on-error',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
