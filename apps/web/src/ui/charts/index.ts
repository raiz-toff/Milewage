// MileWage's chart primitives (design guide, "Charts"): one family on the chart tokens, each with
// its table and keyboard reading. Pages import from here.
export { BarChart } from './BarChart';
export type { BarSeries, BarSlot } from './BarChart';
export { LineChart } from './LineChart';
export type { LineSeries, LineSlot } from './LineChart';
export { Heatmap, HEAT_STEPS } from './Heatmap';
export type { HeatCell } from './Heatmap';
export { InlineBar, RankBars, SegmentBar, Sparkline } from './small';
export type { Part, Rank } from './small';
export {
  ChartEmpty,
  ChartFigure,
  ChartSkeleton,
  ChartTooltip,
  Legend,
  Swatch,
  tipText,
  useActive,
  useWidth,
} from './frame';
export type { LegendItem, TableData, Tip } from './frame';
export { chartColor, seriesColor, tint } from './colors';
export * from './scale';
