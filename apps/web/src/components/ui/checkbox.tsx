import * as React from 'react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { CheckIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Material 3 checkbox (m3.material.io/components/checkbox): an 18 px box with 2 px corners, a
 * 2 px on-surface-variant outline, primary when checked, and a 40 px round state layer.
 */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer relative flex size-[18px] shrink-0 items-center justify-center rounded-[2px] border-2 border-on-surface-variant text-on-surface-variant transition-colors outline-none after:absolute after:-inset-[11px] after:rounded-full after:bg-current after:opacity-0 after:transition-opacity hover:after:opacity-[0.08] focus-visible:after:opacity-[0.1] focus-visible:outline-3 focus-visible:outline-offset-[13px] focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-[0.38] aria-invalid:border-destructive data-checked:border-primary data-checked:bg-primary data-checked:text-on-primary data-checked:after:bg-primary',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5 [&>svg]:stroke-[3]"
      >
        <CheckIcon />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
