import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { formatDistance, formatMoney, formatTime } from '../format';
import { RouteSketch } from '../map/RouteSketch';
import type { RouteData } from '../map/route';
import { PlatformBadge } from '../platforms/PlatformBadge';
import type { PlatformLike } from '../platforms/PlatformBadge';
import { usePlatformOf } from '../platforms/usePlatforms';
import { useSession, useSettings } from '../session';
import { EmptyState, Section } from '../ui/layout';
import { dateWords } from './Shifts';

type Shift = Schemas['Shift'];
interface Extra {
  /** Effective earnings after app fees; null when nothing was entered or labelled. */
  cents: number | null;
  /** Platform slugs, in the order the server gives them. */
  platforms: string[];
}

/** True once the element has come near the screen (always, where IntersectionObserver is missing). */
function useSeen<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (seen || !ref.current) return;
    const io = new IntersectionObserver(
      (e) => {
        if (e.some((x) => x.isIntersecting)) setSeen(true);
      },
      { rootMargin: '200px' },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen] as const;
}

/**
 * One recent shift, Comma's row: platforms, date, time and distance, then what it earned and per
 * hour, then a sketch of the route. Earnings and route are read when the row comes into view,
 * only with their modules on; either failing just leaves it out.
 */
function ShiftRow({
  shift,
  platformOf,
}: {
  shift: Shift;
  platformOf: (slug: string) => PlatformLike;
}) {
  const { api } = useSession();
  const settings = useSettings();
  const { modules, currency, timezone: tz } = settings;
  const [ref, seen] = useSeen<HTMLAnchorElement>();
  const [extra, setExtra] = useState<Extra | null>(null);
  const [route, setRoute] = useState<RouteData | null>(null);
  useEffect(() => {
    if (!seen) return;
    const path = { params: { path: { ref: String(shift.id) } } };
    if (modules.earnings)
      void unwrap(api.GET('/shifts/{ref}/earnings', path))
        .then((e) =>
          setExtra({
            cents: e.effective.length ? e.effective.reduce((t, r) => t + r.total_cents, 0) : null,
            platforms: e.effective.map((r) => r.platform),
          }),
        )
        .catch(() => setExtra(null));
    if (modules.replay)
      void unwrap(api.GET('/shifts/{ref}/route', path))
        .then(setRoute)
        .catch(() => setRoute(null));
  }, [api, seen, shift.id, modules.earnings, modules.replay]);

  const hours = shift.ended_at ? (shift.ended_at - shift.started_at) / 3_600_000 : null;
  const review = shift.flags?.filter((f) => f.severity === 'review').length ?? 0;
  const cents = extra?.cents ?? null;
  return (
    <Link
      ref={ref}
      to={`/shifts/${shift.id}`}
      className="flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {extra && extra.platforms.length > 0 ? (
            <span className="flex min-w-0 items-center gap-2 font-medium">
              <span className="flex shrink-0 -space-x-1">
                {extra.platforms.map((slug) => (
                  <PlatformBadge
                    key={slug}
                    platform={platformOf(slug)}
                    className="ring-2 ring-card"
                  />
                ))}
              </span>
              <span className="truncate">
                {extra.platforms.map((slug) => platformOf(slug).label).join(', ')}
              </span>
            </span>
          ) : (
            <span className="truncate font-medium">Shift</span>
          )}
          {shift.status === 'active' ? <Badge variant="outline">In progress</Badge> : null}
          {review > 0 ? (
            <Badge variant="outline" className="border-primary/60">
              {review} to review
            </Badge>
          ) : null}
        </div>
        <p className="flex flex-wrap gap-x-1.5 text-sm text-muted-foreground tabular-nums *:whitespace-nowrap">
          <span>
            {dateWords(shift.local_date, { weekday: 'short', month: 'short', day: 'numeric' })} ·
          </span>
          <span>
            {formatTime(shift.started_at, tz)}–
            {shift.ended_at ? formatTime(shift.ended_at, tz) : 'now'} ·
          </span>
          <span>{formatDistance(shift.total_m, settings.distance_unit)}</span>
        </p>
      </div>
      {modules.earnings ? (
        <div className="shrink-0 text-right tabular-nums">
          <div className="font-semibold">
            {extra ? (cents === null ? '—' : formatMoney(cents, currency)) : null}
          </div>
          <div className="text-xs text-muted-foreground">
            {!extra
              ? null
              : cents === null
                ? 'not entered'
                : hours
                  ? `${formatMoney(Math.round(cents / hours), currency)} / h`
                  : null}
          </div>
        </div>
      ) : null}
      {modules.replay ? (
        <div className="hidden h-12 w-16 shrink-0 overflow-hidden rounded-md bg-muted/60 min-[360px]:block">
          {route ? <RouteSketch route={route} /> : null}
        </div>
      ) : null}
    </Link>
  );
}

/** The latest five shifts (Comma's "Recent sessions"), with "View all". */
export function RecentShifts() {
  const { api } = useSession();
  const { modules } = useSettings();
  const platformOf = usePlatformOf();
  const [rows, setRows] = useState<Shift[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    void unwrap(api.GET('/shifts', { params: { query: { limit: 5 } } }))
      .then((p) => live && setRows(p.items))
      .catch((e) => live && setError(describe(e)));
    return () => {
      live = false;
    };
  }, [api, attempt]);
  return (
    <Section
      title="Recent shifts"
      label="Recent shifts"
      action={
        <Button asChild variant="ghost" size="sm">
          <Link to="/shifts">View all</Link>
        </Button>
      }
    >
      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-destructive">{error}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Try again
          </Button>
        </div>
      ) : rows === null ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : rows.length === 0 ? (
        <EmptyState>
          No shifts yet. Shifts are recorded on the phone.{' '}
          {modules.devices ? (
            <Link
              to="/devices"
              className="font-medium text-foreground underline underline-offset-4"
            >
              Pair your phone
            </Link>
          ) : null}
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {rows.map((s) => (
            <li key={s.id}>
              <ShiftRow shift={s} platformOf={platformOf} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
