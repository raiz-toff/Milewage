import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** The top of every page: title, one line of context, and the page's actions on the right. */
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
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

/** A titled card. `label` makes it a named region (tests and screen readers find it by name). */
export function Section({
  title,
  description,
  action,
  label,
  className,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={className} {...(label ? { role: 'region', 'aria-label': label } : {})}>
      {title || action ? (
        <div className="flex items-start justify-between gap-4 px-(--card-spacing)">
          <div className="space-y-1">
            {title ? <h2 className="text-base leading-snug font-medium">{title}</h2> : null}
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

/** One figure with its label, and an optional line under it. */
export function StatCard({
  label,
  value,
  sub,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <Card size="sm" className={className}>
      <CardContent className="space-y-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold tracking-tight tabular-nums">{value}</div>
        {sub ? <div className="text-xs text-muted-foreground tabular-nums">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

/** What a list says when it has nothing in it. */
export function EmptyState({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** shadcn's table look for a plain <table>: muted header, row rules, hover. */
export const tableClass =
  'w-full text-left text-sm [&_tbody_tr]:border-t [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-muted/40 [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-middle [&_th]:h-10 [&_th]:px-3 [&_th]:font-medium [&_th]:whitespace-nowrap [&_th]:text-muted-foreground [&_thead]:bg-muted/50';

/** The bordered, scrollable box a data table sits in. */
export function TableBox({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-xl border bg-card">{children}</div>;
}
