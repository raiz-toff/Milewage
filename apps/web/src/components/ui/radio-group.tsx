import * as React from 'react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn('grid w-full gap-2', className)}
      {...props}
    />
  );
}

/**
 * Material 3 radio button (m3.material.io/components/radio-button): a 20 px ring, 2 px
 * on-surface-variant, primary with a 10 px dot when selected, and a 40 px round state layer.
 */
function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        'group/radio-group-item peer relative flex aspect-square size-5 shrink-0 rounded-full border-2 border-on-surface-variant text-on-surface-variant outline-none after:absolute after:-inset-[10px] after:rounded-full after:bg-current after:opacity-0 after:transition-opacity hover:after:opacity-[0.08] focus-visible:after:opacity-[0.1] focus-visible:outline-3 focus-visible:outline-offset-[12px] focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-[0.38] aria-invalid:border-destructive data-checked:border-primary data-checked:text-primary',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="flex size-full items-center justify-center"
      >
        <span className="size-2.5 rounded-full bg-primary" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

export { RadioGroup, RadioGroupItem };
