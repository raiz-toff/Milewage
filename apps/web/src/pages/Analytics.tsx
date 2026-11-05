import { useEffect, useState } from 'react';
import { describe, unwrap } from '../api/client';
import { formatMoney } from '../format';
import { useSession, useSettings } from '../session';
import { FormError } from '../ui/form';
import { localDate } from './Dashboard';

type Mode = 'week' | 'month' | 'year';
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The local dates of the week, month or year `offset` periods from the one containing `today`. */
export function rangeOf(mode: Mode, offset: number, today: string, weekStart: number) {
  const t = Date.parse(`${today}T00:00:00Z`);
  const [y, m] = today.split('-').map(Number) as [number, number];
  if (mode === 'week') {
    const start = t - ((new Date(t).getUTCDay() - weekStart + 7) % 7) * DAY + offset * 7 * DAY;
    return { from: iso(start), to: iso(start + 6 * DAY) };
  }
  if (mode === 'month') {
    return { from: iso(Date.UTC(y, m - 1 + offset, 1)), to: iso(Date.UTC(y, m + offset, 0)) };
  }
  return { from: `${y + offset}-01-01`, to: `${y + offset}-12-31` };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = Record<string, any>;
const GROUPS = [
  'cards',
  'trends',
  'sources',
  'rhythm',
  'outlook',
  'efficiency',
  'order_economics',
] as const;

/** Analytics (module `analytics`, 18 section 10.1): a period navigator and the groups the server returns. */
export function AnalyticsPage() {
  const { api } = useSession();
  const { timezone, currency, week_start: weekStart } = useSettings();
  const [mode, setMode] = useState<Mode>('week');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const range = rangeOf(mode, offset, localDate(Date.now(), timezone), weekStart);
  const money = (c: number | null | undefined) =>
    c == null ? 'not available' : formatMoney(c, currency);

  useEffect(() => {
    let live = true;
    setData(null);
    void Promise.all(
      GROUPS.map(async (group) => {
        const r = await unwrap<{ data: unknown }>(
          api.GET('/analytics', {
            params: {
              query: {
                from: range.from,
                to: range.to,
                group,
                ...(group === 'trends' ? { bucket: mode === 'year' ? 'month' : 'day' } : {}),
              },
            },
          }),
        );
        return [group, r.data] as const;
      }),
    )
      .then((pairs) => live && setData(Object.fromEntries(pairs)))
      .catch((e) => live && setError(describe(e)));
    return () => {
      live = false;
    };
  }, [api, range.from, range.to, mode]);

  const cards = data?.cards as Data | undefined;
  const tiles: [string, string | null][] = cards
    ? [
        ['Gross', money(cards.gross_cents)],
        ...(cards.expenses_cents === undefined
          ? []
          : ([
              ['Expenses', money(cards.expenses_cents)],
              [
                'Burn ratio',
                cards.burn_ratio == null
                  ? 'not available'
                  : `${(cards.burn_ratio * 100).toFixed(1)}%`,
              ],
              ['Net take-home', money(cards.net_take_home_cents)],
            ] as [string, string][])),
        ...(cards.tax_set_aside_cents === undefined
          ? []
          : ([['Tax set-aside', money(cards.tax_set_aside_cents)]] as [string, string][])),
        ['Per hour (shift time)', money(cards.hourly_shift_cents)],
        ['Per hour (online time)', money(cards.hourly_online_cents)],
        ['Total time', `${cards.total_hours} h`],
      ]
    : [];

  return (
    <section className="space-y-6">
      <h1 className="font-heading text-2xl">Analytics</h1>
      <FormError message={error} />
      <div className="flex items-center gap-3">
        {(['week', 'month', 'year'] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            className={`rounded border px-3 py-1 ${mode === m ? 'border-accent text-accent' : 'border-line text-muted'}`}
            onClick={() => {
              setMode(m);
              setOffset(0);
            }}
          >
            {m[0]!.toUpperCase() + m.slice(1)}
          </button>
        ))}
        <button
          type="button"
          aria-label="Previous period"
          className="px-2"
          onClick={() => setOffset(offset - 1)}
        >
          ‹
        </button>
        <span className="font-mono text-sm">
          {range.from} to {range.to}
        </span>
        <button
          type="button"
          aria-label="Next period"
          className="px-2"
          disabled={offset >= 0}
          onClick={() => setOffset(offset + 1)}
        >
          ›
        </button>
      </div>
      {data === null ? (
        <p className="text-muted">Loading</p>
      ) : (
        <>
          <dl className="grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Figures">
            {tiles.map(([k, v]) => (
              <div key={k} className="rounded border border-line bg-card p-3">
                <dt className="text-sm text-muted">{k}</dt>
                <dd className="text-lg">{v}</dd>
              </div>
            ))}
          </dl>
          <section aria-label="Trends" className="space-y-1">
            <h2 className="font-heading text-lg">Trends</h2>
            {data.trends.buckets.length === 0 ? (
              <p className="text-muted">No shifts in this period.</p>
            ) : (
              <table className="w-full max-w-2xl text-left text-sm">
                <thead className="text-muted">
                  <tr>
                    <th className="font-normal">Period</th>
                    <th className="font-normal">Shifts</th>
                    <th className="font-normal">Hours</th>
                    <th className="font-normal">Earnings</th>
                    <th className="font-normal">Per hour</th>
                  </tr>
                </thead>
                <tbody>
                  {data.trends.buckets.map((b: Data) => (
                    <tr key={b.start} className="border-t border-line">
                      <td className="font-mono">{b.start}</td>
                      <td>{b.shifts}</td>
                      <td>{b.hours}</td>
                      <td>{money(b.earnings_cents)}</td>
                      <td>{money(b.hourly_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-sm text-muted">
              Previous period: {money(data.trends.previous.earnings_cents)},{' '}
              {data.trends.previous.hours} h
            </p>
          </section>
          {data.sources.length > 0 ? (
            <section aria-label="Income sources" className="space-y-1">
              <h2 className="font-heading text-lg">Income sources</h2>
              <ul className="text-sm">
                {data.sources.map((s: Data) => (
                  <li key={s.platform}>
                    {s.platform}: {money(s.earnings_cents)} ({Math.round((s.share ?? 0) * 100)}%)
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section aria-label="Outlook" className="space-y-1 text-sm">
            <h2 className="font-heading text-lg">Outlook</h2>
            {data.outlook.projected_earnings_cents === null ? (
              <p className="text-muted">Not enough shifts to project ({data.outlook.note}).</p>
            ) : (
              <p>
                At this pace the period ends near {money(data.outlook.projected_earnings_cents)},{' '}
                {data.outlook.days_left} days left. A projection, not a promise.
              </p>
            )}
          </section>
          <section aria-label="Efficiency" className="space-y-1 text-sm">
            <h2 className="font-heading text-lg">Efficiency</h2>
            {data.efficiency.active_share === null ? (
              <p className="text-muted">No stop-based split for these shifts.</p>
            ) : (
              <p>
                Active {Math.round(data.efficiency.active_share * 100)}% and deadhead{' '}
                {Math.round(data.efficiency.deadhead_share * 100)}% (estimated from detected stops).
              </p>
            )}
            {data.order_economics ? (
              <p>
                {data.order_economics.orders} orders,{' '}
                {money(data.order_economics.pay_per_order_cents)} each,{' '}
                {data.order_economics.orders_per_hour} per hour.
              </p>
            ) : null}
          </section>
          <section aria-label="Work rhythm" className="space-y-1 text-sm">
            <h2 className="font-heading text-lg">Work rhythm</h2>
            <p>
              Average shift:{' '}
              {data.rhythm.average_shift_minutes === null
                ? 'not available'
                : `${data.rhythm.average_shift_minutes} min`}
              . Busiest weekday:{' '}
              {(() => {
                const best = [...data.rhythm.by_weekday].sort(
                  (a: Data, b: Data) => b.shifts - a.shifts,
                )[0];
                return best && best.shifts > 0
                  ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
                      best.weekday
                    ]
                  : 'not available';
              })()}
              .
            </p>
          </section>
        </>
      )}
    </section>
  );
}
