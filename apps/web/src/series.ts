// The figures behind the charts: `GET /summary/series` per day or month, the period a figure is
// compared with, the names of a chart's slots, and which chart colour a platform wears. Pages draw
// with ui/charts; the day arithmetic stays in days.ts.
import { useCallback } from 'react';
import type { Schemas } from './api/client';
import { useApiQuery } from './api/query';
import { addDays, dateWords, period } from './days';
import type { Range } from './days';
import { useSettings } from './session';
import { chartColor, seriesColor } from './ui/charts';

export type Bucket = Schemas['SeriesBucket'];
export type BucketKind = 'day' | 'month';

/** The series of a range, per day or month, every slot included. */
export const useSeries = (range: Range, bucket: BucketKind, enabled = true) =>
  useApiQuery(
    '/summary/series',
    { params: { query: { from: range.from, to: range.to, bucket } } },
    { enabled },
  );

/**
 * A slot's axis label and full name. Days of one week read "Mon"; longer runs of days read the day
 * of the month; months read "Jan". The full name goes in the tooltip and the table.
 */
export function slotNames(start: string, bucket: BucketKind, count: number) {
  if (bucket === 'month')
    return {
      tick: dateWords(start, { month: 'short' }),
      name: dateWords(start, { month: 'long', year: 'numeric' }),
    };
  return {
    tick: count <= 7 ? dateWords(start, { weekday: 'short' }) : String(Number(start.slice(8, 10))),
    name: dateWords(start, { weekday: 'short', month: 'short', day: 'numeric' }),
  };
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

export type CompareKind = 'today' | 'week' | 'month' | 'year' | '30d';

/**
 * What a period is compared with: the previous period of the same kind up to the same point.
 * A week from Monday to today against last Monday to the same weekday; a month to the 10th against
 * last month to the 10th (or its last day); a year to Nov 10 against last year to Nov 10; today
 * against all of yesterday; 30 days against the 30 before. A period that is over is compared whole.
 * `words` finishes "more than …" in the product's voice.
 */
export function comparedWith(kind: CompareKind, range: Range, today: string) {
  const end = range.to < today ? range.to : today;
  const n = daysBetween(range.from, end);
  let prev: Range;
  if (kind === 'today') prev = { from: addDays(range.from, -1), to: addDays(end, -1) };
  else if (kind === 'week') prev = { from: addDays(range.from, -7), to: addDays(end, -7) };
  else if (kind === 'month') {
    const last = period('month', range.from, 1, -1);
    const to = addDays(last.from, n - 1);
    prev = { from: last.from, to: to < last.to ? to : last.to };
  } else if (kind === 'year') {
    const y = Number(range.from.slice(0, 4)) - 1;
    const md = end.slice(5) === '02-29' ? '02-28' : end.slice(5);
    prev = { from: `${y}-01-01`, to: `${y}-${md}` };
  } else prev = { from: addDays(range.from, -n), to: addDays(range.from, -1) };
  // A period still running today is compared up to the same point.
  const point = end === today;
  const words: Record<CompareKind, string> = {
    today: 'yesterday',
    week: point ? 'by this point last week' : 'the week before',
    month: point ? 'by this point last month' : 'the month before',
    year: point ? 'by this point last year' : 'the year before',
    '30d': `the ${n} days before`,
  };
  return { current: { from: range.from, to: end }, previous: prev, words: words[kind] };
}

/**
 * The chart colour of each platform: its place in the driver's own list (Settings > Platforms,
 * active ones first, in their order) gives categorical slot 1 to 8, so a platform keeps its colour
 * in every chart and period. "Other", and anything past eight, is `chart-other`.
 */
export function usePlatformColors(): (slug: string) => string {
  const { modules } = useSettings();
  const list =
    useApiQuery(
      '/platforms',
      { params: { query: { include_inactive: true } } },
      { enabled: modules.platforms },
    ).data ?? NONE;
  return useCallback(
    (slug: string) => {
      const order = [...list.filter((p) => p.active), ...list.filter((p) => !p.active)]
        .map((p) => p.slug)
        .filter((s) => s !== 'other');
      const i = order.indexOf(slug);
      return i < 0 ? chartColor.other : seriesColor(i + 1);
    },
    [list],
  );
}
const NONE: Schemas['Platform'][] = [];

/** Business distance of a bucket or a summary: active plus deadhead (the unsplit is in active). */
export const businessOf = (b: { active_m: number; deadhead_m: number }) =>
  b.active_m + b.deadhead_m;
