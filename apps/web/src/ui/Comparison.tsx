import { ArrowDownwardIcon, ArrowUpwardIcon } from '@/ui/icons';
import { cn } from '@/lib/utils';

/**
 * A figure against the same figure of the period before, in words and with the sign as an arrow,
 * never by colour alone: "↑ $40.20 (38%) more than by this point last week ($106.90)". Nothing is
 * said when either side is unknown, and a period before with nothing in it is said in words.
 */
export function Comparison({
  current,
  previous,
  format,
  words,
  className,
}: {
  current: number | null;
  previous: number | null;
  format: (v: number) => string;
  /** What the figure is compared with: "by this point last week", "yesterday". */
  words: string;
  className?: string;
}) {
  if (current === null || previous === null) return null;
  // Nothing before: a percentage or a difference from zero says nothing more than the figure.
  if (previous === 0)
    return current === 0 ? null : (
      <p
        data-testid="comparison"
        className={cn('text-body-medium text-on-surface-variant', className)}
      >
        Nothing earned {words}.
      </p>
    );
  const d = current - previous;
  const pct = previous > 0 ? Math.round((Math.abs(d) / previous) * 100) : null;
  const Icon = d > 0 ? ArrowUpwardIcon : d < 0 ? ArrowDownwardIcon : null;
  return (
    <p
      data-testid="comparison"
      className={cn(
        'flex items-start gap-1.5 text-body-medium text-on-surface-variant tabular-nums',
        className,
      )}
    >
      {/* The arrow in a small disc, green for more and orange for less; the words say it too. */}
      {Icon ? (
        <span
          aria-hidden
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-full',
            d > 0
              ? 'bg-earned-container text-on-earned-container'
              : 'bg-spent-container text-on-spent-container',
          )}
        >
          <Icon className="size-3.5" />
        </span>
      ) : null}
      <span>
        {d === 0 ? (
          <>The same as {words}</>
        ) : (
          <>
            <span className="text-on-surface">
              {format(Math.abs(d))}
              {pct !== null && pct > 0 ? ` (${pct}%)` : ''} {d > 0 ? 'more' : 'less'}
            </span>{' '}
            than {words}
          </>
        )}{' '}
        ({format(previous)})
      </span>
    </p>
  );
}
