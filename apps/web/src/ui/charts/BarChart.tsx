import { cn } from '@/lib/utils';
import { chartColor } from './colors';
import { ChartTooltip, LiveTip, useActive, useWidth } from './frame';
import type { Tip } from './frame';
import { bands, labelStep, linear, stackMax, stackRows, topRoundedRect, valueAxis } from './scale';

export interface BarSeries {
  key: string;
  label: string;
  color: string;
}

/** One slot on the x axis: a day, a month, a weekday. */
export interface BarSlot {
  key: string;
  /** The axis label, short ("Tue", "10", "Nov"). */
  tick: string;
  /** The full name for the tooltip and the table ("Tue, Nov 10"). */
  name: string;
  /** One value per series; null is "not entered", drawn as no bar. */
  values: (number | null)[];
  /** A slot still to come (the rest of this week): no bar, and the keyboard skips it. */
  future?: boolean;
  /** A quiet line for the tooltip ("2 shifts"). */
  note?: string;
}

const AXIS_BAND = 22; // the x labels under the plot
const TOP = 18; // room above the tallest bar for its direct label

/**
 * Vertical bars, one series or stacked, on a nice zero-based axis: hairline grid in `chart-grid`,
 * the baseline in `chart-axis`, ticks in label-small. Bars are at most 24 px with 4 px rounded data
 * ends and a 2 px surface gap between stacked parts. Only the tallest slot is labelled; hovering or
 * keyboard focus (one tab stop, then the arrow keys) shows the tooltip, which a live region reads.
 * `emphasis` draws that slot in colour and the others in `chart-other` (today against the week).
 */
export function BarChart({
  label,
  series,
  slots,
  format,
  tick = format,
  height = 160,
  emphasis,
  unit = 'slot',
}: {
  label: string;
  series: BarSeries[];
  slots: BarSlot[];
  /** A value as the tooltip and the direct label write it. */
  format: (v: number) => string;
  /** A value as an axis tick writes it (shorter: no cents). */
  tick?: (v: number) => string;
  /** The plot's height in px, without the axis labels. */
  height?: number;
  emphasis?: number;
  /** What a slot is, for the keyboard hint ("day", "month"). */
  unit?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const { active, setActive, focusProps } = useActive(slots.length, (i) => !slots[i]!.future);
  const rows = slots.map((s) => s.values);
  const axis = valueAxis(stackMax(rows));
  const tickText = axis.ticks.map(tick);
  const left = Math.max(...tickText.map((t) => t.length)) * 6.6 + 10;
  const plotW = Math.max(40, width - left);
  const b = bands(slots.length, left, plotW);
  const y = linear(0, axis.max, TOP + height, TOP);
  const stacks = stackRows(rows, series.length);
  const every = labelStep(slots.length, plotW, Math.max(...slots.map((s) => s.tick.length)));
  const totals = rows.map((r) => r.reduce<number>((a, v) => a + (v ?? 0), 0));
  const known = rows.map((r) => r.some((v) => v !== null));
  // One direct label: on the emphasised slot, else on the tallest slot with figures.
  let top = -1;
  totals.forEach((t, i) => {
    if (known[i] && !slots[i]!.future && t > 0 && (top < 0 || t > totals[top]!)) top = i;
  });
  if (emphasis !== undefined) top = known[emphasis] ? emphasis : -1;

  const tipFor = (i: number): Tip => {
    const s = slots[i]!;
    const one = series.length === 1;
    if (!known[i])
      return { title: s.name, value: s.future ? 'Still to come' : 'Not entered', note: s.note };
    return {
      title: s.name,
      value: format(totals[i]!),
      rows: one
        ? undefined
        : series
            .map((se, k) => ({ label: se.label, value: s.values[k], color: se.color }))
            .filter((r) => r.value)
            .map((r) => ({ ...r, value: format(r.value!) })),
      note: s.note,
    };
  };
  const tip = active === null ? null : tipFor(active);
  const total = TOP + height + AXIS_BAND;

  return (
    <div
      ref={ref}
      role="group"
      aria-roledescription="chart"
      aria-label={`${label}. Use the arrow keys to read each ${unit}.`}
      className="relative rounded-small focus-ring"
      onPointerLeave={() => setActive(null)}
      onPointerMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        const i = b.at(e.clientX - box.left);
        setActive(i !== null && !slots[i]!.future ? i : null);
      }}
      {...focusProps}
    >
      <svg aria-hidden width={width} height={total} className="block overflow-visible">
        {axis.ticks.map((t, k) => (
          <g key={t}>
            <line
              x1={left}
              x2={left + plotW}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? chartColor.axis : chartColor.grid}
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text
              x={left - 8}
              y={y(t)}
              dy="0.35em"
              textAnchor="end"
              className="fill-on-surface-variant text-label-small tabular-nums"
            >
              {tickText[k]}
            </text>
          </g>
        ))}
        {active !== null ? (
          // The state layer of the slot under the pointer or the keyboard (Material's hover, 8 %).
          <rect
            x={left + active * b.step}
            y={TOP}
            width={b.step}
            height={height}
            rx={4}
            className="fill-on-surface"
            opacity={0.08}
          />
        ) : null}
        <g className="chart-rise">
          {slots.map((s, i) =>
            series.map((se, k) => {
              const [lo, hi] = stacks[k]![i]!;
              if (hi <= lo || s.values[k] === null) return null;
              let upper = y(hi);
              let bottom = y(lo);
              const above = series.slice(k + 1).some((_, j) => (s.values[k + 1 + j] ?? 0) > 0);
              if (lo > 0) bottom -= 1; // the 2 px surface gap between stacked parts
              if (above) upper += 1;
              const h = bottom - upper;
              if (h <= 0.5) return null;
              const color = emphasis === undefined || emphasis === i ? se.color : chartColor.other;
              return (
                <path
                  key={`${s.key}-${se.key}`}
                  data-slot={s.key}
                  data-series={se.key}
                  d={
                    above
                      ? `M${b.x(i)},${upper}h${b.bar}v${h}h${-b.bar}Z`
                      : topRoundedRect(b.x(i), upper, b.bar, h)
                  }
                  style={{ fill: color }}
                />
              );
            }),
          )}
        </g>
        {top >= 0 && top !== active && totals[top]! > 0 ? (
          <text
            x={b.center(top)}
            y={y(totals[top]!) - 6}
            textAnchor="middle"
            className="fill-on-surface-variant text-label-small tabular-nums"
          >
            {format(totals[top]!)}
          </text>
        ) : null}
        {slots.map((s, i) =>
          i % every === 0 ? (
            <text
              key={s.key}
              x={every === 1 ? b.center(i) : left + i * b.step}
              y={TOP + height + 16}
              textAnchor={every === 1 ? 'middle' : 'start'}
              className={cn(
                'text-label-small tabular-nums',
                s.future ? 'fill-on-surface-variant/70' : 'fill-on-surface-variant',
              )}
            >
              {s.tick}
            </text>
          ) : null,
        )}
      </svg>
      <ChartTooltip
        tip={tip}
        x={active === null ? 0 : b.center(active)}
        y={active === null ? 0 : Math.min(y(Math.max(0, totals[active]!)), TOP + height) - 8}
        width={width}
      />
      <LiveTip tip={tip} />
    </div>
  );
}
