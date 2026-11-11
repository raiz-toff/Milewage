import { useState } from 'react';
import { useApiQuery } from '../api/query';
import { addDays, period, weekOf } from '../days';
import type { Range } from '../days';
import {
  formatDistance,
  formatDistanceTick,
  formatHours,
  formatMoney,
  formatMoneyTick,
  fromMetres,
  toMajor,
  toMinor,
} from '../format';
import { PlatformName } from '../platforms/PlatformBadge';
import { usePlatformOf } from '../platforms/usePlatforms';
import { businessOf, comparedWith, slotNames, usePlatformColors, useSeries } from '../series';
import type { Bucket, BucketKind, CompareKind } from '../series';
import { useSettings } from '../session';
import { SegmentedButtons } from '../ui/chips';
import { Comparison } from '../ui/Comparison';
import { Est } from '../ui/Est';
import { Section } from '../ui/layout';
import {
  BarChart,
  ChartEmpty,
  ChartFigure,
  ChartSkeleton,
  RankBars,
  SegmentBar,
  chartColor,
  tint,
} from '../ui/charts';
import type { Part } from '../ui/charts';

// The dashboard's charts (plan: "How did this period go, compared with the last? Where did the
// money and the miles come from?"): the comparison under the hero figure, one trend chart for the
// period, and one breakdown. They follow the period tabs.

export type PeriodId = CompareKind;

/** The slots the trend chart draws for a period tab, and which slot is the point. */
export function chartRange(id: PeriodId, today: string, weekStart: number) {
  const r = (range: Range, bucket: BucketKind, emphasisLast = false) => ({
    range,
    bucket,
    emphasisLast,
  });
  if (id === 'today') return r({ from: addDays(today, -6), to: today }, 'day', true);
  if (id === 'week') {
    const from = weekOf(today, weekStart);
    return r({ from, to: addDays(from, 6) }, 'day');
  }
  if (id === 'month') return r(period('month', today, weekStart), 'day');
  if (id === 'year') return r(period('year', today, weekStart), 'month');
  return r({ from: addDays(today, -29), to: today }, 'day');
}

/** The period's earnings against the period before, up to the same point. */
export function PeriodComparison({
  id,
  range,
  today,
  earned,
}: {
  id: PeriodId;
  range: Range;
  today: string;
  earned: number | null;
}) {
  const { currency } = useSettings();
  const c = comparedWith(id, range, today);
  const prev = useApiQuery('/summary', { params: { query: c.previous } }).data;
  if (!prev || earned === null) return null;
  return (
    <Comparison
      current={earned}
      previous={prev.earnings_cents ?? (prev.shift_count === 0 ? 0 : null)}
      format={(v) => formatMoney(v, currency)}
      words={c.words}
    />
  );
}

type Measure = 'earned' | 'distance' | 'time';

const shifts = (n: number) => (n === 0 ? 'No shifts' : `${n} ${n === 1 ? 'shift' : 'shifts'}`);

/**
 * The period's one trend chart: bars per day (per month for Year), earned, business distance or
 * shift time. Today is drawn against the six days before it, today in colour and the rest quiet.
 * The rest of this week (or month, or year) shows as empty slots.
 */
export function PeriodTrend({
  id,
  today,
  earningsPossible,
}: {
  id: PeriodId;
  today: string;
  /** Earnings can be entered or labelled on this server (the module or stops is on). */
  earningsPossible: boolean;
}) {
  const settings = useSettings();
  const { currency, distance_unit: unit } = settings;
  const spec = chartRange(id, today, settings.week_start);
  const q = useSeries(spec.range, spec.bucket);
  const [picked, setPicked] = useState<Measure | null>(null);
  if (q.error) return null; // the figures above still say it; the chart is extra
  if (!q.data) return <ChartSkeleton height={140} bars={spec.bucket === 'month' ? 12 : 7} />;
  const buckets = q.data.buckets;
  const anyEarned = buckets.some((b) => (b.earnings_cents ?? 0) !== 0);
  const measure: Measure = picked ?? (earningsPossible && anyEarned ? 'earned' : 'distance');
  const options = [
    ...(earningsPossible ? [{ value: 'earned' as const, label: 'Earned' }] : []),
    { value: 'distance' as const, label: 'Distance' },
    { value: 'time' as const, label: 'Time' },
  ];
  const monthOf = today.slice(0, 7);
  const future = (b: Bucket) =>
    spec.bucket === 'month' ? b.start.slice(0, 7) > monthOf : b.start > today;
  const per = spec.bucket === 'month' ? 'month' : 'day';
  const words: Record<PeriodId, string> = {
    today: 'today and the 6 days before',
    week: 'this week',
    month: 'this month',
    year: 'this year',
    '30d': 'the last 30 days',
  };
  const nothing = buckets.every((b) => b.shift_count === 0 && !b.earnings_cents);
  const value = (b: Bucket): number | null =>
    measure === 'earned'
      ? b.earnings_cents === null
        ? null
        : toMajor(b.earnings_cents, currency)
      : measure === 'distance'
        ? fromMetres(businessOf(b), unit)
        : b.hours;
  const fmt =
    measure === 'earned'
      ? (v: number) => formatMoney(toMinor(v, currency), currency)
      : measure === 'distance'
        ? (v: number) => formatDistanceTick(Math.round(v * 10) / 10, unit)
        : formatHours;
  const tickFmt =
    measure === 'earned'
      ? (v: number) => formatMoneyTick(v, currency)
      : measure === 'distance'
        ? (v: number) => formatDistanceTick(v, unit)
        : (v: number) => `${v} h`;
  const name = { earned: 'Earned', distance: 'Business distance', time: 'Shift time' }[measure];
  const label = `${name} each ${per}, ${words[id]}`;
  const noEarnings = measure === 'earned' && !anyEarned;
  const shown = buckets.filter((b) => !future(b));
  // Nothing at all to draw: the sentence alone, no switch and no table of empty rows.
  if (nothing)
    return (
      <ChartEmpty>
        No shifts {id === 'today' ? 'in the last 7 days' : words[id]} yet. Start one on your phone.
      </ChartEmpty>
    );
  return (
    <ChartFigure
      label={label}
      toolbar={
        <SegmentedButtons
          label="Chart shows"
          value={measure}
          options={options}
          onChange={(m) => setPicked(m)}
        />
      }
      table={{
        columns: [
          { label: per === 'day' ? 'Day' : 'Month' },
          ...(earningsPossible ? [{ label: 'Earned', numeric: true }] : []),
          { label: 'Business distance', numeric: true },
          { label: 'Shift time', numeric: true },
          { label: 'Shifts', numeric: true },
        ],
        rows: shown.map((b) => ({
          key: b.start,
          head: slotNames(b.start, spec.bucket, buckets.length).name,
          cells: [
            ...(earningsPossible
              ? [
                  b.earnings_cents === null
                    ? 'Not entered'
                    : formatMoney(b.earnings_cents, currency),
                ]
              : []),
            formatDistance(businessOf(b), unit),
            formatHours(b.hours),
            b.shift_count,
          ],
        })),
      }}
    >
      {noEarnings ? (
        <ChartEmpty>No earnings entered for {words[id]}. Enter them on a shift.</ChartEmpty>
      ) : (
        <BarChart
          label={label}
          unit={per}
          height={140}
          series={[
            {
              key: measure,
              label: name,
              color: measure === 'earned' ? chartColor.earned : chartColor.measure,
            },
          ]}
          slots={buckets.map((b) => ({
            key: b.start,
            ...slotNames(b.start, spec.bucket, buckets.length),
            values: [future(b) ? null : value(b)],
            future: future(b),
            note: shifts(b.shift_count),
          }))}
          format={fmt}
          tick={tickFmt}
          emphasis={spec.emphasisLast ? buckets.length - 1 : undefined}
        />
      )}
    </ChartFigure>
  );
}

/** The period's split, worked out once for the breakdown card and the hero's footnote. */
export function useBreakdown(id: PeriodId, range: Range, today: string) {
  const settings = useSettings();
  const spec = chartRange(id, today, settings.week_start);
  const q = useSeries(spec.range, spec.bucket);
  if (!q.data) return null;
  const monthOf = (d: string) => d.slice(0, 7);
  const inside = q.data.buckets.filter((b) =>
    spec.bucket === 'month'
      ? monthOf(b.start) >= monthOf(range.from) && monthOf(b.start) <= monthOf(range.to)
      : b.start >= range.from && b.start <= range.to,
  );
  const byPlatform = new Map<string, number>();
  for (const b of inside)
    for (const p of b.platforms)
      byPlatform.set(p.platform, (byPlatform.get(p.platform) ?? 0) + p.earnings_cents);
  const platforms = [...byPlatform].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
  if (settings.modules.platforms && platforms.length >= 2)
    return { kind: 'money' as const, platforms };
  const sum = (f: (b: Bucket) => number) => inside.reduce((a, b) => a + f(b), 0);
  const unsplit = sum((b) => b.unsplit_m);
  const active = sum((b) => b.active_m) - unsplit;
  const deadhead = sum((b) => b.deadhead_m);
  const personal = sum((b) => b.personal_m);
  const split = active + deadhead > 0 && unsplit === 0;
  const kinds = split ? [active, deadhead, personal] : [active + unsplit + deadhead, personal];
  if (kinds.filter((m) => m > 0).length < 2) return null;
  return { kind: 'distance' as const, split, active, deadhead, unsplit, personal };
}

/**
 * Where the period's money came from (two or more platforms with earnings), else where the miles
 * went (business and personal, with the active and deadhead estimate where there is one). Nothing
 * at all when there is no split to show, so it leaves no hole.
 */
export function PeriodBreakdown({
  id,
  range,
  today,
}: {
  id: PeriodId;
  range: Range;
  today: string;
}) {
  const { currency, distance_unit: unit } = useSettings();
  const platformOf = usePlatformOf();
  const colorOf = usePlatformColors();
  const data = useBreakdown(id, range, today);
  if (!data) return null;
  const when = {
    today: 'Today',
    week: 'This week',
    month: 'This month',
    year: 'This year',
    '30d': 'The last 30 days',
  }[id];

  if (data.kind === 'money')
    return (
      <Section
        label="Where the money came from"
        title="Where the money came from"
        description={`${when}, earned after app fees.`}
      >
        <RankBars
          label="Earned by platform"
          items={data.platforms.map(([slug, cents]) => ({
            key: slug,
            text: platformOf(slug).label,
            name: <PlatformName platform={platformOf(slug)}>{platformOf(slug).label}</PlatformName>,
            value: cents,
            figure: formatMoney(cents, currency),
            // Each platform in its own chart colour, the same as on Analytics.
            color: colorOf(slug),
          }))}
        />
      </Section>
    );

  const { split, active, deadhead, unsplit, personal } = data;
  const part = (key: string, label: string, m: number, color: string, est = false): Part => ({
    key,
    label,
    value: m,
    color,
    figure: formatDistance(m, unit),
    mark: est ? <Est /> : undefined,
  });
  const parts = split
    ? [
        part('active', 'Active', active, chartColor.measure, true),
        part('deadhead', 'Deadhead', deadhead, tint(chartColor.measure, 45), true),
        part('personal', 'Personal', personal, chartColor.personal),
      ]
    : [
        part('business', 'Business', active + unsplit + deadhead, chartColor.measure),
        part('personal', 'Personal', personal, chartColor.personal),
      ];
  const title = unit === 'mi' ? 'Where the miles went' : 'Where the kilometres went';
  return (
    <Section label={title} title={title} description={`${when}, all distance on shift.`}>
      <SegmentBar label="Distance by kind" parts={parts} />
      {split ? (
        <p className="text-body-small text-on-surface-variant">
          * Estimated from detected stops. Active is driven with an order, deadhead without one.
        </p>
      ) : null}
    </Section>
  );
}
