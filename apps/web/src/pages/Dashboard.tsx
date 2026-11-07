import { useEffect, useState } from 'react';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { formatDistance, formatMoney } from '../format';
import { useSession, useSettings } from '../session';
import { GoalRing, RegionPrompt, SetupChecklist } from './DashboardExtras';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Picker } from '../ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, PageHeader, Section } from '../ui/layout';
import { Est, ShiftCard } from './Shifts';

type Summary = Schemas['Summary'];

const DAY = 86_400_000;

/** A calendar date YYYY-MM-DD in the instance time zone. */
export function localDate(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(new Date(ms));
}

export interface Period {
  id: string;
  label: string;
  range: (now: number, timeZone: string, weekStart?: number) => { from: string; to: string };
}

export const PERIODS: Period[] = [
  {
    id: '30d',
    label: 'Last 30 days',
    range: (now, tz) => ({ from: localDate(now - 29 * DAY, tz), to: localDate(now, tz) }),
  },
  {
    id: 'month',
    label: 'This month',
    range: (now, tz) => {
      const to = localDate(now, tz);
      return { from: `${to.slice(0, 7)}-01`, to };
    },
  },
  {
    id: 'today',
    label: 'Today',
    range: (now, tz) => ({ from: localDate(now, tz), to: localDate(now, tz) }),
  },
  {
    id: 'week',
    label: 'This week',
    range: (now, tz, weekStart = 1) => {
      const to = localDate(now, tz);
      const t = Date.parse(`${to}T00:00:00Z`);
      const back = (new Date(t).getUTCDay() - weekStart + 7) % 7;
      return { from: new Date(t - back * DAY).toISOString().slice(0, 10), to };
    },
  },
  {
    id: 'year',
    label: 'This year',
    range: (now, tz) => {
      const to = localDate(now, tz);
      return { from: `${to.slice(0, 4)}-01-01`, to };
    },
  },
];

function Metric({
  title,
  children,
  note,
}: {
  title: string;
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <Card role="region" aria-label={title}>
      <CardContent className="space-y-2">
        <h2 className="text-sm text-muted-foreground">{title}</h2>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">{children}</p>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </CardContent>
    </Card>
  );
}

/** The latest few shifts, as on the Shifts page. Hidden when they cannot be read. */
function RecentShifts() {
  const { api } = useSession();
  const settings = useSettings();
  const [rows, setRows] = useState<Schemas['Shift'][] | null>(null);
  useEffect(() => {
    let live = true;
    void unwrap(api.GET('/shifts', { params: { query: { limit: 5 } } }))
      .then((p) => live && setRows(p.items))
      .catch(() => live && setRows(null));
    return () => {
      live = false;
    };
  }, [api]);
  if (!rows) return null;
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
      {rows.length === 0 ? (
        <EmptyState>No shifts yet. Shifts start on the phone.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {rows.map((s) => (
            <li key={s.id}>
              <ShiftCard shift={s} settings={settings} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/**
 * The three dashboard metrics of 05 section 4 and nothing else: hourly earnings, deduction
 * value, and the active/deadhead split. Earnings come from the driver's own stop labels, so
 * "not entered" is shown when there are none, never zero.
 */
export function Dashboard({ now }: { now?: number }) {
  const { api } = useSession();
  const settings = useSettings();
  const [period, setPeriod] = useState(PERIODS[0]!.id);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { from, to } = PERIODS.find((p) => p.id === period)!.range(
    now ?? Date.now(),
    settings.timezone,
    settings.week_start,
  );

  useEffect(() => {
    let live = true;
    setSummary(null);
    setError(null);
    void unwrap(api.GET('/summary', { params: { query: { from, to } } }))
      .then((s) => live && setSummary(s))
      .catch((e) => live && setError(describe(e)));
    return () => {
      live = false;
    };
  }, [api, from, to]);

  const stops = settings.modules.stops;
  const unit = settings.distance_unit;
  return (
    <section className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={
          <span className="tabular-nums">
            {from} to {to}
          </span>
        }
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <label htmlFor="dashboard-period">Period</label>
          <Picker
            id="dashboard-period"
            className="w-auto min-w-32"
            value={period}
            onChange={setPeriod}
            options={PERIODS.map((p) => ({ value: p.id, label: p.label }))}
          />
        </div>
      </PageHeader>
      <RegionPrompt />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : summary === null ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid gap-4 sm:grid-cols-3">
            <Metric
              title="Hourly earnings"
              note={
                stops
                  ? 'Pay plus tips from your stop labels, divided by shift hours.'
                  : 'Needs stop labels. Detecting stops is switched off.'
              }
            >
              {summary.hourly_earnings_cents === null
                ? stops
                  ? 'not entered'
                  : 'unavailable'
                : `${formatMoney(summary.hourly_earnings_cents, settings.currency)} / h`}
            </Metric>
            <Metric
              title={
                settings.mileage_rate === 'yours'
                  ? 'Deduction value (your rate)'
                  : 'Deduction value'
              }
              note={
                summary.deduction_cents === null
                  ? 'No tax rules are registered for this country.'
                  : settings.mileage_rate === 'yours'
                    ? 'Distance times your rate. It is not an official rate.'
                    : 'Distance times the rate for your country and year.'
              }
            >
              {summary.deduction_cents === null
                ? 'not available'
                : formatMoney(summary.deduction_cents, settings.currency)}
            </Metric>
            {stops ? (
              <Metric title="Active vs deadhead">
                {formatDistance(summary.active_m, unit)} /{' '}
                {formatDistance(summary.deadhead_m, unit)}
                <Est />
              </Metric>
            ) : (
              <Metric title="Business distance">
                {formatDistance(summary.active_m + summary.deadhead_m, unit)}
              </Metric>
            )}
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
            <p className="tabular-nums">
              {summary.shift_count} {summary.shift_count === 1 ? 'shift' : 'shifts'},{' '}
              {summary.hours.toFixed(1)} hours, {formatDistance(summary.total_m, unit)} in total.
            </p>
            {stops ? <p>* estimated from detected stops</p> : null}
          </div>
        </div>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <SetupChecklist />
        {settings.modules.goals ? <GoalRing /> : null}
      </div>
      <RecentShifts />
    </section>
  );
}
