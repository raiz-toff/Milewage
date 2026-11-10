import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import { cn } from '@/lib/utils';
import { withRipple } from '@/components/ui/ripple';

/**
 * Material 3 buttons (m3.material.io/components/buttons): a full pill, 40 px high, label-large
 * text, a state layer for hover and focus and a ripple on press.
 *
 * - `default`: the screen's one primary action. Material's filled button in the brand's colour:
 *   primary-container, which the Fidelity scheme sets to Lane yellow itself in both themes (the
 *   colour Material gives the most important action on a screen, the FAB's). One per screen.
 * - `filled`: Material's filled button in `primary`, for a strong action that is not the brand one.
 * - `tonal` (`secondary` is the same): the filled tonal button, secondary-container.
 * - `elevated`: surface-container-low with the level 1 shadow.
 * - `outline`: the outlined button.
 * - `ghost`: the text button.
 * - `destructive`: a tonal button in the error container colours.
 * - `link`: inline text with the brand underline, for a link inside a sentence.
 */
const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center rounded-full border border-transparent text-label-large whitespace-nowrap transition-[background-color,color,box-shadow,border-color] duration-200 ease-standard select-none state-layer focus-ring disabled:pointer-events-none disabled:opacity-[0.38] aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        default: 'bg-primary-container text-on-primary-container hover:shadow-elevation-1',
        filled: 'bg-primary text-on-primary hover:shadow-elevation-1',
        tonal: 'bg-secondary-container text-on-secondary-container hover:shadow-elevation-1',
        secondary: 'bg-secondary-container text-on-secondary-container hover:shadow-elevation-1',
        elevated:
          'bg-surface-container-low text-primary shadow-elevation-1 hover:shadow-elevation-2',
        outline: 'border-outline bg-transparent text-primary',
        ghost: 'bg-transparent text-primary',
        destructive: 'bg-error-container text-on-error-container',
        link: 'h-auto! rounded-sm px-0! text-foreground underline decoration-primary decoration-2 underline-offset-4 before:hidden hover:decoration-[3px]',
      },
      size: {
        default:
          'h-10 gap-2 px-6 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4 has-[>svg:first-child]:pl-4',
        xs: "h-7 gap-1 px-3 text-label-medium [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 has-[>svg:first-child]:pl-3 [&_svg:not([class*='size-'])]:size-4",
        lg: 'h-12 gap-2 px-6 text-title-medium has-[>svg:first-child]:pl-5',
        icon: "size-10 [&_svg:not([class*='size-'])]:size-5",
        'icon-xs': "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        'icon-sm': "size-8 [&_svg:not([class*='size-'])]:size-[18px]",
        'icon-lg': "size-12 [&_svg:not([class*='size-'])]:size-6",
      },
    },
    compoundVariants: [
      // Icon buttons: the standard icon button is on-surface-variant, not primary.
      {
        variant: 'ghost',
        size: ['icon', 'icon-xs', 'icon-sm', 'icon-lg'],
        className: 'text-on-surface-variant aria-expanded:text-on-surface',
      },
      {
        variant: 'outline',
        size: ['icon', 'icon-xs', 'icon-sm', 'icon-lg'],
        className: 'border-outline-variant text-on-surface-variant',
      },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  onPointerDown,
  children,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      onPointerDown={variant === 'link' ? onPointerDown : withRipple(onPointerDown)}
      {...props}
    >
      {children}
    </Comp>
  );
}

export { Button, buttonVariants };
