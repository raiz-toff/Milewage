import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * The top of every page: title (Material headline, small on phones and medium from `md`), one
 * line of context in body-medium on-surface-variant, and the page's actions on the right.
 */
export function PageHeader({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <h1 className="text-headline-small text-on-surface md:text-headline-medium">{title}</h1>
        {description ? (
          <p className="text-body-medium text-on-surface-variant">{description}</p>
        ) : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

/**
 * A titled card. `label` makes it a named region (tests and screen readers find it by name).
 * `bare` drops the card and the title, for a section shown inside another card.
 */
export function Section({
  title,
  description,
  action,
  label,
  className,
  bare,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  label?: string;
  className?: string;
  bare?: boolean;
  children: ReactNode;
}) {
  const region = label ? { role: 'region', 'aria-label': label } : {};
  if (bare)
    return (
      <div className={cn('space-y-4', className)} {...region}>
        {children}
      </div>
    );
  return (
    <Card className={className} {...region}>
      {title || action ? (
        <div className="flex items-start justify-between gap-4 px-(--card-spacing)">
          <div className="space-y-1">
            {title ? <h2 className="text-title-medium text-on-surface">{title}</h2> : null}
            {description ? (
              <p className="text-body-medium text-on-surface-variant">{description}</p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

/**
 * Money in or out: the `earned` or `spent` colour for a figure whose label already says which
 * (never the only signal, never for status). Android's `StatTone`.
 */
export type MoneyTone = 'earned' | 'spent';
export const moneyText: Record<MoneyTone, string> = {
  earned: 'text-earned',
  spent: 'text-spent',
};

/** One figure with its label, and an optional line under it (label-medium, title-large figure). */
export function StatCard({
  label,
  value,
  sub,
  tone,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** Only for a money figure whose label says in words whether it came in or went out. */
  tone?: MoneyTone;
  className?: string;
}) {
  return (
    <Card size="sm" className={className}>
      <CardContent className="space-y-1">
        <div className="text-label-medium text-on-surface-variant">{label}</div>
        <div
          className={cn(
            'text-title-large font-medium text-on-surface tabular-nums',
            tone && moneyText[tone],
          )}
        >
          {value}
        </div>
        {sub ? (
          <div className="text-body-small text-on-surface-variant tabular-nums">{sub}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** What a list says when it has nothing in it. */
export function EmptyState({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-dashed border-outline-variant p-8 text-center text-body-medium text-on-surface-variant',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The Material data table look for a plain <table> (components/ui/table.tsx has the reasons): a
 * 48 px header in title-small on-surface-variant on surface-container, body-medium rows with
 * outline-variant rules, an on-surface wash on hover.
 */
export const tableClass =
  'w-full text-left text-body-medium [&_tbody_tr]:border-t [&_tbody_tr]:border-outline-variant [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-on-surface/8 [&_td]:h-[52px] [&_td]:px-4 [&_td]:py-1.5 [&_td]:align-middle [&_th]:h-12 [&_th]:px-4 [&_th]:text-title-small [&_th]:whitespace-nowrap [&_th]:text-on-surface-variant [&_thead]:bg-surface-container';

/** The outlined, scrollable box a data table sits in (medium corners). */
export function TableBox({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-outline-variant bg-card">
      {children}
    </div>
  );
}
