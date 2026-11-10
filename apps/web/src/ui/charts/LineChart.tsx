import { chartColor } from './colors';
import { ChartTooltip, LiveTip, useActive, useWidth } from './frame';
import type { Tip } from './frame';
import { bands, labelStep, linePath, linear, valueAxis } from './scale';

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  /** One value per slot; null breaks the line (nothing is drawn across a gap). */
  values: (number | null)[];
}

export interface LineSlot {
  key: string;
  tick: string;
  name: string;
}

const AXIS_BAND = 22;
const TOP = 12;

/**
 * Lines for a measure that is continuous over the slots (a running total), 2 px with round joins,
 * the last point of each marked with a ringed dot; or `dots` alone for a figure that exists only
 * on some slots (pay per hour on the days worked), never joined across the gaps. A `reference`
 * draws one hairline (the period's figure); its words go in the figure's note, not over the marks. The crosshair and the tooltip list
 * every series at the slot, on hover and on keyboard focus.
 */
export function LineChart({
  label,
  series,
  slots,
  format,
  tick = format,
  height = 140,
  dots = false,
  reference,
  unit = 'slot',
}: {
  label: string;
  series: LineSeries[];
  slots: LineSlot[];
  format: (v: number) => string;
  tick?: (v: number) => string;
  height?: number;
  dots?: boolean;
  reference?: { value: number; label: string };
  unit?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const has = (i: number) => series.some((s) => s.values[i] !== null);
  const { active, setActive, focusProps } = useActive(slots.length, has);
  const max = Math.max(
    0,
    reference?.value ?? 0,
    ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)),
  );
  const axis = valueAxis(max);
  const tickText = axis.ticks.map(tick);
  const left = Math.max(...tickText.map((t) => t.length)) * 6.6 + 10;
  const plotW = Math.max(40, width - left);
  const b = bands(slots.length, left, plotW);
  const y = linear(0, axis.max, TOP + height, TOP);
  const every = labelStep(slots.length, plotW, Math.max(...slots.map((s) => s.tick.length)));
  const point = (v: number | null, i: number) => (v === null ? null : { x: b.center(i), y: y(v) });

  const tipFor = (i: number): Tip => {
    const rows = series
      .filter((s) => s.values[i] !== null)
      .map((s) => ({ label: s.label, value: format(s.values[i]!), color: s.color }));
    return series.length === 1
      ? { title: slots[i]!.name, value: rows[0]?.value ?? 'No figure' }
      : { title: slots[i]!.name, rows };
  };
  const tip = active === null ? null : tipFor(active);
  const topOf = (i: number) =>
    Math.min(...series.map((s) => (s.values[i] === null ? TOP + height : y(s.values[i]!))));

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
        setActive(i !== null && has(i) ? i : null);
      }}
      {...focusProps}
    >
      <svg
        aria-hidden
        width={width}
        height={TOP + height + AXIS_BAND}
        className="block overflow-visible"
      >
        {axis.ticks.map((t, k) => (
          <g key={t}>
            <line
              x1={left}
              x2={left + plotW}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? chartColor.axis : chartColor.grid}
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
        {reference && reference.value > 0 ? (
          <g>
            <line
              x1={left}
              x2={left + plotW}
              y1={y(reference.value)}
              y2={y(reference.value)}
              stroke={chartColor.axis}
              shapeRendering="crispEdges"
            />
          </g>
        ) : null}
        {active !== null ? (
          <line
            x1={b.center(active)}
            x2={b.center(active)}
            y1={TOP}
            y2={TOP + height}
            stroke={chartColor.axis}
            shapeRendering="crispEdges"
          />
        ) : null}
        {series.map((s) => {
          const pts = s.values.map(point);
          const last = pts.findLastIndex((p) => p !== null);
          const marks = dots ? pts.map((p, i) => (p ? i : -1)).filter((i) => i >= 0) : [last];
          return (
            <g key={s.key} data-series={s.key}>
              {dots ? null : (
                <path
                  d={linePath(pts)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
              {marks
                .filter((i) => i >= 0)
                .map((i) => (
                  <circle
                    key={i}
                    data-slot={slots[i]!.key}
                    cx={pts[i]!.x}
                    cy={pts[i]!.y}
                    r={active === i ? 5 : 4}
                    style={{ fill: s.color, stroke: chartColor.surface }}
                    strokeWidth={2}
                  />
                ))}
            </g>
          );
        })}
        {slots.map((s, i) =>
          i % every === 0 ? (
            <text
              key={s.key}
              x={every === 1 ? b.center(i) : left + i * b.step}
              y={TOP + height + 16}
              textAnchor={every === 1 ? 'middle' : 'start'}
              className="fill-on-surface-variant text-label-small tabular-nums"
            >
              {s.tick}
            </text>
          ) : null,
        )}
      </svg>
      <ChartTooltip
        tip={tip}
        x={active === null ? 0 : b.center(active)}
        y={active === null ? 0 : topOf(active) - 10}
        width={width}
      />
      <LiveTip tip={tip} />
    </div>
  );
}
