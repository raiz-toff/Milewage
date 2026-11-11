import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Schemas } from '../api/client';
import {
  formatDistance,
  formatDistanceTick,
  formatHours,
  formatMoney,
  formatMoneyTick,
  fromMetres,
  hourLabel,
  toMajor,
  toMinor,
} from '../format';
import type { DistanceUnit, TimeFormat } from '../format';
import { PlatformName } from '../platforms/PlatformBadge';
import type { PlatformLike } from '../platforms/PlatformBadge';
import { businessOf, slotNames } from '../series';
import type { Bucket, BucketKind } from '../series';
import { SegmentedButtons } from '../ui/chips';
import { Section, TableBox, tableClass } from '../ui/layout';
import {
  BarChart,
  ChartFigure,
  Heatmap,
  InlineBar,
  LineChart,
  RankBars,
  Sparkline,
  chartColor,
  tint,
} from '../ui/charts';
import type { BarSeries, HeatCell } from '../ui/charts';

// The Analytics page's sections, one question each, drawn with ui/charts from
// `GET /summary/series` and `GET /analytics/breakdown`. Every figure goes through the formatters
// in the driver's settings; every chart has its table.

type Breakdown = Schemas['AnalyticsBreakdown'];

export interface Ctx {
  currency: string;
  unit: DistanceUnit;
  timeFormat: TimeFormat;
  weekStart: number;
  today: string;
  bucket: BucketKind;
  /** "this week", "Nov 2026": the period in words, for names and empty states. */
  when: string;
}

const money = (ctx: Ctx) => (major: number) =>
  formatMoney(toMinor(major, ctx.currency), ctx.currency);
const moneyTick = (ctx: Ctx) => (major: number) => formatMoneyTick(major, ctx.currency);
const per = (ctx: Ctx) => (ctx.bucket === 'month' ? 'month' : 'day');
const future = (ctx: Ctx, b: Bucket) =>
  ctx.bucket === 'month' ? b.start.slice(0, 7) > ctx.today.slice(0, 7) : b.start > ctx.today;
const slotsOf = (ctx: Ctx, buckets: Bucket[]) =>
  buckets.map((b) => ({
    key: b.start,
    ...slotNames(b.start, ctx.bucket, buckets.length),
    future: future(ctx, b),
  }));
const shiftsWord = (n: number) => (n === 0 ? 'No shifts' : `${n} ${n === 1 ? 'shift' : 'shifts'}`);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Earned over time, stacked by platform when more than one earned in the period (each in its own
 * colour, the same in every period), else pay and tips. Tips are in the tooltip and the table.
 */
export function EarningsOverTime({
  ctx,
  buckets,
  platformOf,
  colorOf,
  byPlatform,
}: {
  ctx: Ctx;
  buckets: Bucket[];
  platformOf: (slug: string) => PlatformLike;
  colorOf: (slug: string) => string;
  /** The platforms module is on. */
  byPlatform: boolean;
}) {
  const totals = new Map<string, number>();
  for (const b of buckets)
    for (const p of b.platforms)
      totals.set(p.platform, (totals.get(p.platform) ?? 0) + p.earnings_cents);
  const platforms = [...totals].filter(([, c]) => c !== 0).map(([slug]) => slug);
  const stacked = byPlatform && platforms.length > 1;
  const tips = sum(buckets.map((b) => b.tips_cents ?? 0));
  const earned = sum(buckets.map((b) => b.earnings_cents ?? 0));
  const label = `Earned each ${per(ctx)}, ${ctx.when}`;
  if (!buckets.some((b) => b.earnings_cents)) return null;
  const series: BarSeries[] = stacked
    ? platforms.map((slug) => ({ key: slug, label: platformOf(slug).label, color: colorOf(slug) }))
    : [
        { key: 'pay', label: 'Pay', color: chartColor.earned },
        { key: 'tips', label: 'Tips', color: tint(chartColor.earned, 50) },
      ];
  const valuesOf = (b: Bucket): (number | null)[] =>
    future(ctx, b)
      ? series.map(() => null)
      : stacked
        ? platforms.map((slug) => {
            const p = b.platforms.find((x) => x.platform === slug);
            return b.earnings_cents === null ? null : toMajor(p?.earnings_cents ?? 0, ctx.currency);
          })
        : b.earnings_cents === null
          ? [null, null]
          : [
              toMajor(b.earnings_cents - (b.tips_cents ?? 0), ctx.currency),
              toMajor(b.tips_cents ?? 0, ctx.currency),
            ];
  const cents = (c: number | null) => (c === null ? 'Not entered' : formatMoney(c, ctx.currency));
  return (
    <ChartFigure
      label={label}
      legend={series.map((s) => ({ label: s.label, color: s.color }))}
      note={
        earned > 0
          ? `Tips were ${formatMoney(tips, ctx.currency)} of it (${Math.round((tips / earned) * 100)}%).`
          : undefined
      }
      table={{
        columns: [
          { label: per(ctx) === 'day' ? 'Day' : 'Month' },
          ...(stacked ? platforms.map((s) => ({ label: platformOf(s).label, numeric: true })) : []),
          { label: 'Tips', numeric: true },
          { label: 'Earned', numeric: true },
        ],
        rows: buckets
          .filter((b) => !future(ctx, b))
          .map((b) => ({
            key: b.start,
            head: slotNames(b.start, ctx.bucket, buckets.length).name,
            cells: [
              ...(stacked
                ? platforms.map((slug) =>
                    cents(
                      b.earnings_cents === null
                        ? null
                        : (b.platforms.find((p) => p.platform === slug)?.earnings_cents ?? 0),
                    ),
                  )
                : []),
              cents(b.tips_cents),
              cents(b.earnings_cents),
            ],
          })),
      }}
    >
      <BarChart
        label={label}
        unit={per(ctx)}
        series={series}
        slots={slotsOf(ctx, buckets).map((s, i) => {
          const b = buckets[i]!;
          return {
            ...s,
            values: valuesOf(b),
            note: `${shiftsWord(b.shift_count)}${b.tips_cents ? `, ${formatMoney(b.tips_cents, ctx.currency)} in tips` : ''}`,
          };
        })}
        format={money(ctx)}
        tick={moneyTick(ctx)}
      />
    </ChartFigure>
  );
}

/**
 * The running total of earnings through this period against the period before, slot by slot:
 * continuous, so a line. This period in the earned colour, the last in `chart-other`.
 */
export function RunningTotal({
  ctx,
  current,
  previous,
}: {
  ctx: Ctx;
  current: Bucket[];
  previous: Bucket[];
}) {
  const run = (bs: Bucket[], stop: (b: Bucket) => boolean) => {
    let t = 0;
    return bs.map((b) => {
      if (stop(b)) return null;
      t += b.earnings_cents ?? 0;
      return toMajor(t, ctx.currency);
    });
  };
  const n = Math.max(current.length, previous.length);
  const cur = run(current, (b) => future(ctx, b));
  const prev = run(previous, () => false);
  const pad = <T,>(xs: (T | null)[]) => [...xs, ...Array<null>(n - xs.length).fill(null)];
  if (!current.some((b) => b.earnings_cents) && !previous.some((b) => b.earnings_cents))
    return null;
  const slots = Array.from({ length: n }, (_, i) => {
    const b = current[i] ?? previous[i]!;
    const names = slotNames(b.start, ctx.bucket, n);
    const day = ctx.bucket === 'day' && n > 7 ? `Day ${i + 1}` : names.tick;
    return {
      key: String(i),
      tick: current[i] ? names.tick : day,
      name: current[i] ? names.name : `${day} of the period before`,
    };
  });
  const label = `Running total of earnings, ${ctx.when} against the period before`;
  return (
    <ChartFigure
      label={label}
      legend={[
        { label: 'This period', color: chartColor.earned, shape: 'line' },
        { label: 'The period before', color: chartColor.other, shape: 'line' },
      ]}
      table={{
        columns: [
          { label: per(ctx) === 'day' ? 'Day' : 'Month' },
          { label: 'This period', numeric: true },
          { label: 'The period before', numeric: true },
        ],
        rows: slots.map((s, i) => ({
          key: s.key,
          head: s.name,
          cells: [
            cur[i] == null ? '—' : money(ctx)(cur[i]!),
            prev[i] == null ? '—' : money(ctx)(prev[i]!),
          ],
        })),
      }}
    >
      <LineChart
        label={label}
        unit={per(ctx)}
        slots={slots}
        series={[
          { key: 'prev', label: 'The period before', color: chartColor.other, values: pad(prev) },
          { key: 'cur', label: 'This period', color: chartColor.earned, values: pad(cur) },
        ]}
        format={money(ctx)}
        tick={moneyTick(ctx)}
      />
    </ChartFigure>
  );
}

/**
 * Pay per hour and per mile (or km) for each slot worked, as dots (a rate exists only where there
 * was a shift; nothing joins the gaps), with the period's figure as a reference line. Two small
 * multiples on one row.
 */
export function PayRates({ ctx, buckets }: { ctx: Ctx; buckets: Bucket[] }) {
  const paid = buckets.filter(
    (b) => !future(ctx, b) && b.earnings_cents !== null && b.shift_count > 0,
  );
  if (paid.length === 0) return null;
  const hourly = (b: Bucket) =>
    b.hours > 0 && b.earnings_cents !== null && b.shift_count > 0 && !future(ctx, b)
      ? toMajor(b.earnings_cents, ctx.currency) / b.hours
      : null;
  const distance = (b: Bucket) => fromMetres(businessOf(b), ctx.unit);
  const perDistance = (b: Bucket) =>
    distance(b) > 0 && b.earnings_cents !== null && b.shift_count > 0 && !future(ctx, b)
      ? toMajor(b.earnings_cents, ctx.currency) / distance(b)
      : null;
  const earned = toMajor(sum(paid.map((b) => b.earnings_cents ?? 0)), ctx.currency);
  const hours = sum(paid.map((b) => b.hours));
  const dist = sum(paid.map(distance));
  const slots = slotsOf(ctx, buckets);
  const cell = (v: number | null) => (v === null ? '—' : money(ctx)(v));
  const one = (
    key: string,
    title: string,
    of: (b: Bucket) => number | null,
    avg: number,
    unitWord: string,
  ) => {
    const label = `${title} each ${per(ctx)} worked, ${ctx.when}`;
    return (
      <ChartFigure
        key={key}
        label={label}
        toolbar={<h3 className="text-title-small text-on-surface">{title}</h3>}
        note={avg > 0 ? `The line is the whole period: ${money(ctx)(avg)} ${unitWord}.` : undefined}
        table={{
          columns: [
            { label: per(ctx) === 'day' ? 'Day' : 'Month' },
            { label: title, numeric: true },
          ],
          rows: buckets
            .filter((b) => of(b) !== null)
            .map((b) => ({
              key: b.start,
              head: slotNames(b.start, ctx.bucket, buckets.length).name,
              cells: [cell(of(b))],
            })),
        }}
      >
        <LineChart
          label={label}
          unit={per(ctx)}
          dots
          height={120}
          slots={slots}
          series={[{ key, label: title, color: chartColor.earned, values: buckets.map(of) }]}
          format={(v) => `${money(ctx)(v)} ${unitWord}`}
          tick={moneyTick(ctx)}
          reference={
            avg > 0 ? { value: avg, label: `${money(ctx)(avg)} for the period` } : undefined
          }
        />
      </ChartFigure>
    );
  };
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {one('hour', 'Per hour (shift time)', hourly, hours > 0 ? earned / hours : 0, 'an hour')}
      {one(
        'distance',
        ctx.unit === 'mi' ? 'Per mile (business distance)' : 'Per km (business distance)',
        perDistance,
        dist > 0 ? earned / dist : 0,
        ctx.unit === 'mi' ? 'a mile' : 'a km',
      )}
    </div>
  );
}

/**
 * Distance over time: active and deadhead (estimated from detected stops) and personal, stacked;
 * or business and personal when some shifts have no stop-based split.
 */
export function DistanceOverTime({ ctx, buckets }: { ctx: Ctx; buckets: Bucket[] }) {
  const total = sum(buckets.map((b) => b.total_m));
  if (total === 0) return null;
  const unsplit = sum(buckets.map((b) => b.unsplit_m));
  const split = unsplit === 0 && sum(buckets.map((b) => b.deadhead_m)) > 0;
  const series: (BarSeries & { of: (b: Bucket) => number })[] = split
    ? [
        { key: 'active', label: 'Active*', color: chartColor.measure, of: (b) => b.active_m },
        {
          key: 'deadhead',
          label: 'Deadhead*',
          color: tint(chartColor.measure, 45),
          of: (b) => b.deadhead_m,
        },
        { key: 'personal', label: 'Personal', color: chartColor.personal, of: (b) => b.personal_m },
      ]
    : [
        { key: 'business', label: 'Business', color: chartColor.measure, of: businessOf },
        { key: 'personal', label: 'Personal', color: chartColor.personal, of: (b) => b.personal_m },
      ];
  const shown = series.filter((s) => s.key !== 'personal' || buckets.some((b) => b.personal_m > 0));
  const label = `Distance each ${per(ctx)}, ${ctx.when}`;
  const dist = (v: number) => formatDistanceTick(Math.round(v * 10) / 10, ctx.unit);
  return (
    <ChartFigure
      label={label}
      legend={shown.map((s) => ({ label: s.label, color: s.color }))}
      note={
        split
          ? '* Estimated from detected stops: active is driven with an order, deadhead without one.'
          : unsplit > 0 && sum(buckets.map((b) => b.deadhead_m)) > 0
            ? 'Active and deadhead are shown only for a period where every shift has detected stops.'
            : undefined
      }
      table={{
        columns: [
          { label: per(ctx) === 'day' ? 'Day' : 'Month' },
          ...shown.map((s) => ({ label: s.label, numeric: true })),
          { label: 'Total', numeric: true },
        ],
        rows: buckets
          .filter((b) => !future(ctx, b))
          .map((b) => ({
            key: b.start,
            head: slotNames(b.start, ctx.bucket, buckets.length).name,
            cells: [
              ...shown.map((s) => formatDistance(s.of(b), ctx.unit)),
              formatDistance(b.total_m, ctx.unit),
            ],
          })),
      }}
    >
      <BarChart
        label={label}
        unit={per(ctx)}
        series={shown}
        slots={slotsOf(ctx, buckets).map((s, i) => {
          const b = buckets[i]!;
          return {
            ...s,
            values: s.future
              ? shown.map(() => null)
              : shown.map((x) => fromMetres(x.of(b), ctx.unit)),
            note: shiftsWord(b.shift_count),
          };
        })}
        format={dist}
        tick={(v) => formatDistanceTick(v, ctx.unit)}
      />
    </ChartFigure>
  );
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LONG = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
];
const BLOCK = 3; // hours per column

/**
 * When it pays: pay per hour by weekday and time of day, a heatmap of 3-hour blocks (or the time
 * on shift there, when no earnings are entered). A shift's earnings are spread evenly over its
 * hours, which the note says. The best block with at least an hour behind it is named in words.
 */
export function WhenItPays({
  ctx,
  cells,
  earnings,
}: {
  ctx: Ctx;
  cells: Breakdown['week_hours'];
  earnings: boolean;
}) {
  const [measure, setMeasure] = useState<'rate' | 'time'>('rate');
  if (cells.length === 0) return null;
  const m = earnings ? measure : 'time';
  const days = Array.from({ length: 7 }, (_, i) => (ctx.weekStart + i) % 7);
  const blocks = Array.from({ length: 24 / BLOCK }, (_, i) => i * BLOCK);
  const agg = days.map((d) =>
    blocks.map((h) => {
      const xs = cells.filter((c) => c.weekday === d && c.hour >= h && c.hour < h + BLOCK);
      return {
        hours: sum(xs.map((c) => c.hours)),
        paid: sum(xs.map((c) => c.paid_hours)),
        cents: sum(xs.map((c) => c.earnings_cents ?? 0)),
      };
    }),
  );
  const span = (h: number) =>
    `${hourLabel(h, ctx.timeFormat)} to ${hourLabel((h + BLOCK) % 24, ctx.timeFormat)}`;
  const rate = (a: { paid: number; cents: number }) => (a.paid > 0 ? a.cents / a.paid : null);
  const value = (a: (typeof agg)[number][number]) =>
    m === 'rate'
      ? rate(a) === null
        ? null
        : toMajor(rate(a)!, ctx.currency)
      : a.hours > 0
        ? a.hours
        : null;
  const grid: HeatCell[][] = agg.map((row, ri) =>
    row.map((a, ci) => ({
      value: value(a),
      tip: {
        title: `${WEEKDAY_LONG[days[ri]!]}, ${span(blocks[ci]!)}`,
        value:
          a.hours === 0
            ? 'No shifts'
            : m === 'rate'
              ? rate(a) === null
                ? 'No earnings entered'
                : `${formatMoney(Math.round(rate(a)!), ctx.currency)} an hour`
              : formatHours(a.hours),
        note: a.hours > 0 ? `${formatHours(a.hours)} on shift in ${ctx.when}` : undefined,
      },
    })),
  );
  let best: { ri: number; ci: number; r: number } | null = null;
  agg.forEach((row, ri) =>
    row.forEach((a, ci) => {
      const r = rate(a);
      if (r !== null && a.paid >= 1 && (!best || r > best.r)) best = { ri, ci, r };
    }),
  );
  const b = best as { ri: number; ci: number; r: number } | null;
  const label =
    m === 'rate'
      ? `Pay per hour by day and time, ${ctx.when}`
      : `Time on shift by day and time, ${ctx.when}`;
  const fmtLegend =
    m === 'rate' ? (v: number) => formatMoneyTick(v, ctx.currency) : (v: number) => `${v} h`;
  return (
    <ChartFigure
      label={label}
      toolbar={
        earnings ? (
          <SegmentedButtons
            label="Heat shows"
            value={measure}
            options={[
              { value: 'rate', label: 'Per hour' },
              { value: 'time', label: 'Time on shift' },
            ]}
            onChange={setMeasure}
          />
        ) : undefined
      }
      note={
        m === 'rate'
          ? 'A shift’s earnings are spread evenly over its hours, so a block shows the average pay of the shifts that covered it.'
          : undefined
      }
      table={{
        columns: [
          { label: 'Day' },
          ...blocks.map((h) => ({ label: hourLabel(h, ctx.timeFormat), numeric: true })),
        ],
        rows: agg.map((row, ri) => ({
          key: String(days[ri]),
          head: WEEKDAY_LONG[days[ri]!]!,
          cells: row.map((a) => {
            const v = value(a);
            return v === null
              ? '—'
              : m === 'rate'
                ? formatMoney(toMinor(v, ctx.currency), ctx.currency)
                : formatHours(v);
          }),
        })),
      }}
    >
      {b && m === 'rate' ? (
        <p className="text-body-medium">
          Best: {WEEKDAY_LONG[days[b.ri]!]}, {span(blocks[b.ci]!)}, at{' '}
          <span className="tabular-nums">{formatMoney(Math.round(b.r), ctx.currency)}</span> an hour
          ({formatHours(agg[b.ri]![b.ci]!.paid)} on shift).
        </p>
      ) : null}
      <Heatmap
        label={label}
        rows={days.map((d) => WEEKDAY[d]!)}
        cols={blocks.map((h) => hourLabel(h, ctx.timeFormat))}
        cells={grid}
        color={m === 'rate' ? chartColor.earned : chartColor.measure}
        format={fmtLegend}
      />
    </ChartFigure>
  );
}

/** Two figures on one scale (earned against spent), the bars 8 px with rounded ends. */
function PairBars({
  rows,
}: {
  rows: { label: string; value: number; figure: string; color: string }[];
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3 text-body-medium">
            <span>{r.label}</span>
            <span className="tabular-nums">{r.figure}</span>
          </div>
          <div aria-hidden className="h-2">
            <div
              className="h-2 min-w-1 rounded-full"
              style={{
                width: `${max > 0 ? (Math.max(0, r.value) / max) * 100 : 0}%`,
                background: r.color,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Money in and out: earned against expenses on one scale with the net in words, the expenses by
 * category, and the deduction's value (which lowers taxable income and is not money).
 */
export function MoneyInOut({
  ctx,
  earnedCents,
  deductibleCents,
  categories,
  categoryName,
  deduction,
}: {
  ctx: Ctx;
  earnedCents: number | null;
  /** The deductible part of the expenses, as the figures above count it. */
  deductibleCents: number;
  categories: NonNullable<Breakdown['expense_categories']>;
  categoryName: (slug: string) => string;
  deduction: ReactNode;
}) {
  const earned = earnedCents ?? 0;
  // Money out is what was paid, in full; the deductible part is said in words under it.
  const expensesCents = sum(categories.map((c) => c.spent_cents));
  const net = earned - expensesCents;
  const m = (c: number) => formatMoney(c, ctx.currency);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-4">
        <PairBars
          rows={[
            {
              label: 'Earned, after app fees',
              value: earned,
              figure: m(earned),
              color: chartColor.earned,
            },
            {
              label: 'Spent',
              value: expensesCents,
              figure: m(expensesCents),
              color: chartColor.spent,
            },
          ]}
        />
        <p className="text-body-medium">
          {net >= 0 ? 'Left after expenses: ' : 'Expenses were more than earnings by '}
          <span className="font-medium tabular-nums">{m(Math.abs(net))}</span>
          {earned > 0 && expensesCents > 0
            ? `, expenses were ${Math.round((expensesCents / earned) * 100)}% of earnings.`
            : '.'}
        </p>
        {expensesCents > 0 && deductibleCents !== expensesCents ? (
          <p className="text-body-medium text-on-surface-variant">
            Of what you spent,{' '}
            <span className="font-medium text-on-surface tabular-nums">{m(deductibleCents)}</span>{' '}
            counts as deductible. The rest is a personal share, not deductible, or already covered
            by your mileage rate.
          </p>
        ) : null}
        {deduction}
      </div>
      <div className="space-y-2">
        <h3 className="text-title-small text-on-surface">Expenses by category</h3>
        {categories.length === 0 ? (
          <p className="text-body-medium text-on-surface-variant">No expenses in {ctx.when}.</p>
        ) : (
          <RankBars
            label="Expenses by category"
            items={categories.map((c) => ({
              key: c.category,
              text: categoryName(c.category),
              name: categoryName(c.category),
              value: c.spent_cents,
              figure: m(c.spent_cents),
              color: chartColor.spent,
            }))}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The platforms side by side: earned with its share as an inline bar, tips, shifts, orders and pay
 * per order, and a sparkline of each one's earnings across the period.
 */
export function PlatformTable({
  ctx,
  platforms,
  buckets,
  platformOf,
}: {
  ctx: Ctx;
  platforms: Breakdown['platforms'];
  buckets: Bucket[];
  platformOf: (slug: string) => PlatformLike;
}) {
  const max = Math.max(0, ...platforms.map((p) => p.earnings_cents));
  const total = sum(platforms.map((p) => p.earnings_cents));
  const online = platforms.some((p) => p.online_minutes);
  const m = (c: number) => formatMoney(c, ctx.currency);
  return (
    <TableBox>
      <table className={tableClass}>
        <caption className="sr-only">Platforms compared, {ctx.when}</caption>
        <thead>
          <tr>
            <th scope="col">Platform</th>
            <th scope="col" className="text-right">
              Earned
            </th>
            <th scope="col" className="text-right">
              Share
            </th>
            <th scope="col" className="text-right">
              Tips
            </th>
            <th scope="col" className="text-right">
              Shifts
            </th>
            <th scope="col" className="text-right">
              Orders
            </th>
            <th scope="col" className="text-right">
              Per order
            </th>
            {online ? (
              <th scope="col" className="text-right">
                Per hour (online)
              </th>
            ) : null}
            <th scope="col">Each {per(ctx)}</th>
          </tr>
        </thead>
        <tbody>
          {platforms.map((p) => {
            const name = platformOf(p.platform).label;
            const values = buckets.map((b) =>
              future(ctx, b)
                ? null
                : (b.platforms.find((x) => x.platform === p.platform)?.earnings_cents ?? 0),
            );
            return (
              <tr key={p.platform}>
                <th scope="row" className="font-normal whitespace-nowrap">
                  <PlatformName platform={platformOf(p.platform)}>{name}</PlatformName>
                </th>
                <td className="text-right whitespace-nowrap">
                  <InlineBar value={p.earnings_cents} max={max} color={chartColor.earned}>
                    {m(p.earnings_cents)}
                  </InlineBar>
                </td>
                <td className="text-right tabular-nums">
                  {total > 0 ? Math.round((p.earnings_cents / total) * 100) : 0}%
                </td>
                <td className="text-right tabular-nums">{m(p.tips_cents)}</td>
                <td className="text-right tabular-nums">{p.shifts}</td>
                <td className="text-right tabular-nums">{p.orders ?? '—'}</td>
                <td className="text-right tabular-nums">
                  {p.orders ? m(Math.round(p.earnings_cents / p.orders)) : '—'}
                </td>
                {online ? (
                  <td className="text-right tabular-nums">
                    {p.online_minutes
                      ? m(Math.round(p.earnings_cents / (p.online_minutes / 60)))
                      : '—'}
                  </td>
                ) : null}
                <td>
                  <Sparkline
                    values={values}
                    color={chartColor.earned}
                    label={`${name}, earned each ${per(ctx)} of ${ctx.when}`}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableBox>
  );
}

/** The vehicles side by side: shifts, time, business distance (inline bar), earned and the rates. */
export function VehicleTable({
  ctx,
  vehicles,
  nameOf,
}: {
  ctx: Ctx;
  vehicles: Breakdown['vehicles'];
  nameOf: (id: number | null) => string;
}) {
  const max = Math.max(0, ...vehicles.map((v) => v.business_m));
  const expenses = vehicles.some((v) => v.expenses_cents !== undefined);
  const m = (c: number | null) => (c === null ? 'Not entered' : formatMoney(c, ctx.currency));
  return (
    <TableBox>
      <table className={tableClass}>
        <caption className="sr-only">Vehicles compared, {ctx.when}</caption>
        <thead>
          <tr>
            <th scope="col">Vehicle</th>
            <th scope="col" className="text-right">
              Shifts
            </th>
            <th scope="col" className="text-right">
              Shift time
            </th>
            <th scope="col" className="text-right">
              Business distance
            </th>
            <th scope="col" className="text-right">
              Earned
            </th>
            <th scope="col" className="text-right">
              Per hour
            </th>
            <th scope="col" className="text-right">
              {ctx.unit === 'mi' ? 'Per mile' : 'Per km'}
            </th>
            {expenses ? (
              <th scope="col" className="text-right">
                Expenses
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {vehicles.map((v) => {
            const d = fromMetres(v.business_m, ctx.unit);
            return (
              <tr key={String(v.vehicle_id)}>
                <th scope="row" className="font-normal whitespace-nowrap">
                  {nameOf(v.vehicle_id)}
                </th>
                <td className="text-right tabular-nums">{v.shifts}</td>
                <td className="text-right tabular-nums">{formatHours(v.hours)}</td>
                <td className="text-right whitespace-nowrap">
                  <InlineBar value={v.business_m} max={max} color={chartColor.measure}>
                    {formatDistance(v.business_m, ctx.unit)}
                  </InlineBar>
                </td>
                <td className="text-right tabular-nums">{m(v.earnings_cents)}</td>
                <td className="text-right tabular-nums">
                  {v.earnings_cents !== null && v.hours > 0
                    ? m(Math.round(v.earnings_cents / v.hours))
                    : '—'}
                </td>
                <td className="text-right tabular-nums">
                  {v.earnings_cents !== null && d > 0 ? m(Math.round(v.earnings_cents / d)) : '—'}
                </td>
                {expenses ? (
                  <td className="text-right tabular-nums">{m(v.expenses_cents ?? 0)}</td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableBox>
  );
}

/** A section holding charts: a titled card whose description says the question it answers. */
export function ChartSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Section label={title} title={title} description={description}>
      {children}
    </Section>
  );
}
