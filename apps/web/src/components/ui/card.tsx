import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Material 3 cards (m3.material.io/components/cards), medium corners (12 px), 16 px padding.
 * - `filled` (default): `bg-card`, the app's sections and figures, with no border and no shadow.
 *   White on the grey page in light (surface-container-lowest), one step above the Asphalt page
 *   in dark (surface-container); index.css has the surface model.
 * - `outlined`: the page's own colour with an outline-variant hairline.
 * - `elevated`: `bg-card` with the level 1 shadow.
 * - `highest`: Material's filled card in surface-container-highest, for a card that must stand
 *   out from the cards around it.
 */
type CardVariant = 'filled' | 'outlined' | 'elevated' | 'highest';

const cardVariant: Record<CardVariant, string> = {
  filled: 'bg-card',
  outlined: 'border border-outline-variant bg-background',
  elevated: 'bg-card shadow-elevation-1',
  highest: 'bg-surface-container-highest',
};

function Card({
  className,
  size = 'default',
  variant = 'filled',
  ...props
}: React.ComponentProps<'div'> & { size?: 'default' | 'sm'; variant?: CardVariant }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      data-variant={variant}
      className={cn(
        'group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-medium py-(--card-spacing) text-body-medium text-card-foreground [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-medium *:[img:last-child]:rounded-b-medium',
        cardVariant[variant],
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-medium px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)',
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        'font-heading text-title-medium text-on-surface group-data-[size=sm]/card:text-title-small',
        className,
      )}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-body-medium text-muted-foreground', className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="card-content" className={cn('px-(--card-spacing)', className)} {...props} />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        'flex items-center rounded-b-medium border-t border-outline-variant p-(--card-spacing)',
        className,
      )}
      {...props}
    />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
