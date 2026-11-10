import type { ButtonHTMLAttributes } from 'react';
import { withRipple } from '@/components/ui/ripple';
import { cn } from '@/lib/utils';
import { CheckIcon } from './icons';

/**
 * A Material 3 filter chip (m3.material.io/components/chips): 32 px, small corners, an
 * outline-variant border; selected, it fills with secondary-container and leads with a check.
 * A toggle button (`aria-pressed`), so a screen reader hears whether it is on.
 */
export function FilterChip({
  selected,
  className,
  children,
  onPointerDown,
  ...props
}: { selected: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onPointerDown={withRipple(onPointerDown)}
      className={cn(
        'relative inline-flex h-8 shrink-0 items-center gap-2 rounded-small border px-4 text-label-large whitespace-nowrap state-layer focus-ring transition-colors',
        selected
          ? 'border-transparent bg-secondary-container pl-2 text-on-secondary-container'
          : 'border-outline-variant text-on-surface-variant',
        className,
      )}
      {...props}
    >
      {selected ? <CheckIcon className="size-[18px]" /> : null}
      {children}
    </button>
  );
}

/**
 * Material 3 segmented buttons (m3.material.io/components/segmented-buttons): one choice of a
 * few, 40 px, outlined, the ends fully rounded; the chosen segment is secondary-container with a
 * check. Each segment is a toggle button (`aria-pressed`) inside a named group.
 */
export function SegmentedButtons<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn('inline-flex w-fit', className)}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onPointerDown={withRipple()}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative inline-flex h-10 min-w-12 items-center justify-center gap-2 border border-outline px-3 text-label-large state-layer focus-ring focus-visible:z-10 sm:px-4',
              i > 0 && '-ml-px',
              i === 0 && 'rounded-l-full',
              i === options.length - 1 && 'rounded-r-full',
              on ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface',
            )}
          >
            {on ? <CheckIcon className="size-[18px]" /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
