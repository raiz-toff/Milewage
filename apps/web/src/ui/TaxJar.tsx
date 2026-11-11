import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * The tax jar as a picture: a glass jar that fills from the bottom as the balance nears the
 * target. With a target it is a progress bar for a screen reader (`label`, 0 to 100); without one
 * it is decoration, part full when something is in it. The figures stand beside it. Colours are roles: the glass in outline,
 * the fill in the chart's earned green, because it is money kept.
 */
export function TaxJar({
  label,
  balanceCents,
  targetCents,
  className,
}: {
  label: string;
  balanceCents: number;
  targetCents: number | null;
  className?: string;
}) {
  const clip = useId();
  const pct = targetCents ? Math.max(0, Math.min(100, (balanceCents / targetCents) * 100)) : null;
  // The inside of the jar runs from y = 30 (under the neck) to y = 112.
  const level = pct ?? (balanceCents > 0 ? 40 : 0);
  const top = 112 - (82 * level) / 100;
  const body =
    'M22 30h52a8 8 0 0 1 8 8v64a12 12 0 0 1-12 12H26a12 12 0 0 1-12-12V38a8 8 0 0 1 8-8z';
  const progress =
    pct === null
      ? { 'aria-hidden': true }
      : {
          role: 'progressbar',
          'aria-label': label,
          'aria-valuemin': 0,
          'aria-valuemax': 100,
          'aria-valuenow': Math.round(pct),
        };
  return (
    <div className={cn('relative w-24 shrink-0', className)} {...progress}>
      <svg viewBox="0 0 96 120" className="block w-full" aria-hidden="true">
        <defs>
          <clipPath id={clip}>
            <path d={body} />
          </clipPath>
        </defs>
        {/* The lid and the neck. */}
        <rect x="24" y="6" width="48" height="12" rx="4" className="fill-outline" />
        <rect x="30" y="18" width="36" height="12" className="fill-surface-container-highest" />
        {/* The glass, then what is in it. */}
        <path d={body} className="fill-surface-container-highest" />
        <g clipPath={`url(#${clip})`}>
          <rect
            x="0"
            y={top}
            width="96"
            height={120 - top}
            className="fill-chart-earned transition-[y,height] duration-500 ease-standard motion-reduce:transition-none"
          />
          {/* The surface of what is inside, a shade lighter. */}
          {level > 0 ? (
            <rect x="0" y={top} width="96" height="4" className="fill-surface opacity-30 dark:hidden" />
          ) : null}
        </g>
        <path d={body} fill="none" strokeWidth="2" className="stroke-outline" />
        {/* A glint on the glass. */}
        <path
          d="M24 44v38"
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          className="stroke-surface opacity-60 dark:hidden"
        />
      </svg>
    </div>
  );
}
