import * as React from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

/**
 * Material 3 switch (m3.material.io/components/switch): a 52 by 32 track, outlined in
 * `outline` on surface-container-highest when off, primary when on; the handle grows from 16 to
 * 24 px when on (28 px while pressed). `sm` is a 40 by 24 track for dense rows.
 */
function Switch({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: 'sm' | 'default';
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        'peer group/switch relative inline-flex shrink-0 items-center rounded-full border-2 transition-colors duration-200 ease-standard outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-destructive data-[size=default]:h-8 data-[size=default]:w-[52px] data-[size=sm]:h-6 data-[size=sm]:w-10 data-checked:border-primary data-checked:bg-primary data-unchecked:border-outline data-unchecked:bg-surface-container-highest data-disabled:cursor-not-allowed data-disabled:opacity-[0.38]',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full ring-0 transition-[transform,width,height,background-color] duration-200 ease-standard group-active/switch:size-7! group-data-[size=sm]/switch:group-active/switch:size-5! group-data-[size=default]/switch:data-checked:size-6 group-data-[size=default]/switch:data-unchecked:size-4 group-data-[size=sm]/switch:data-checked:size-[18px] group-data-[size=sm]/switch:data-unchecked:size-3 data-checked:bg-on-primary data-unchecked:bg-outline group-data-[size=default]/switch:data-checked:translate-x-[22px] group-data-[size=default]/switch:data-unchecked:translate-x-1.5 group-data-[size=sm]/switch:data-checked:translate-x-[17px] group-data-[size=sm]/switch:data-unchecked:translate-x-1"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
