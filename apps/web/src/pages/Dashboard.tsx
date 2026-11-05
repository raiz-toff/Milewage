import { useEffect, useState } from 'react';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { formatDistance, formatMoney } from '../format';
import { useSession, useSettings } from '../session';
import { Est } from './Shifts';

type Summary = Schemas['Summary'];

const DAY = 86_400_000;

/** A calendar date YYYY-MM-DD in the instance time zone. */
export function localDate(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(new Date(ms));
}

export interface Period {
  id: string;
  label: string;
  range: (now: number, timeZone: string) => { from: string; to: string };
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
    <section aria-label={title} className="space-y-1 rounded border border-line bg-card p-4">
      <h2 className="text-sm text-muted">{title}</h2>
      <p className="font-mono text-2xl">{children}</p>
      {note ? <p className="text-sm text-muted">{note}</p> : null}
    </section>
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
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl">Dashboard</h1>
        <label className="text-sm text-muted">
          Period{' '}
          <select
            className="rounded border border-line bg-bg px-2 py-1 text-ink"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            {PERIODS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="font-mono text-sm text-muted">
        {from} to {to}
      </p>
      {error ? (
        <p role="alert" className="text-muted">
          {error}
        </p>
      ) : summary === null ? (
        <p className="text-muted">Loading</p>
      ) : (
        <>
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
              title="Deduction value"
              note={
                summary.deduction_cents === null
                  ? 'No tax rules are registered for this country.'
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
          {stops ? <p className="text-sm text-muted">* estimated from detected stops</p> : null}
          <p className="text-sm text-muted">
            {summary.shift_count} {summary.shift_count === 1 ? 'shift' : 'shifts'},{' '}
            {summary.hours.toFixed(1)} hours, {formatDistance(summary.total_m, unit)} in total.
          </p>
        </>
      )}
    </section>
  );
}
