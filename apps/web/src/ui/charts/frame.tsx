import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { EmptyState, tableClass } from '../layout';

// The frame every chart sits in, so they read as one family: the toolbar row with the "Show as a
// table" toggle, the plot, the legend and a footnote, and the table a screen reader always gets
// (hidden from sight until the toggle shows it to everyone). The pattern HourBars began.

export interface TableData {
  /** Column headings; the first is the row heading's ("Day", "Platform"). */
  columns: { label: string; numeric?: boolean }[];
  /** One row per slot or part: its name and its formatted cells, the same figures the chart draws. */
  rows: { key: string; head: string; cells: ReactNode[] }[];
}

export interface LegendItem {
  label: string;
  color: string;
  /** A swatch for bars and areas, a short stroke for lines, a ringed dot for points. */
  shape?: 'rect' | 'line' | 'dot';
}

/** The legend row: a swatch in the series colour beside a name in the text colour. */
export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-label-medium text-on-surface-variant">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <Swatch color={it.color} shape={it.shape} />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

export function Swatch({ color, shape = 'rect' }: { color: string; shape?: LegendItem['shape'] }) {
  if (shape === 'line')
    return <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: color }} />;
  if (shape === 'dot')
    return <span aria-hidden className="size-2.5 rounded-full" style={{ background: color }} />;
  return <span aria-hidden className="size-3 rounded-[3px]" style={{ background: color }} />;
}

/**
 * A chart's figure. `label` names it (the figure's accessible name and the table's caption).
 * `toolbar` sits left of the table toggle (a measure switch); `legend` and `note` go under the plot.
 */
export function ChartFigure({
  label,
  table,
  toolbar,
  legend,
  note,
  children,
  className,
}: {
  label: string;
  table: TableData;
  toolbar?: ReactNode;
  legend?: LegendItem[];
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const tableId = useId();
  const [show, setShow] = useState(false);
  return (
    <figure aria-label={label} className={cn('m-0 min-w-0 space-y-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">{toolbar}</div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-mr-2 ml-auto"
          aria-expanded={show}
          aria-controls={tableId}
          onClick={() => setShow(!show)}
        >
          {show ? 'Hide table' : 'Show as a table'}
        </Button>
      </div>
      {children}
      {legend && legend.length > 1 ? <Legend items={legend} /> : null}
      {note ? <p className="text-body-small text-on-surface-variant">{note}</p> : null}
      <div
        id={tableId}
        className={show ? 'overflow-x-auto rounded-xl border border-outline-variant' : 'sr-only'}
      >
        <table className={tableClass}>
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr>
              {table.columns.map((c, i) => (
                <th key={c.label} scope="col" className={cn(i > 0 && c.numeric && 'text-right')}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.key}>
                <th scope="row" className="font-normal whitespace-nowrap">
                  {r.head}
                </th>
                {r.cells.map((c, i) => (
                  <td
                    key={i}
                    className={cn(
                      'whitespace-nowrap tabular-nums',
                      table.columns[i + 1]?.numeric && 'text-right',
                    )}
                  >
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/** One line of a tooltip: the value leads, the series follows, keyed by a short stroke. */
export interface TipRow {
  label: string;
  value: string;
  color?: string;
}
export interface Tip {
  title: string;
  /** The figure the reader came for (a total, or the one value), strong. */
  value?: string;
  rows?: TipRow[];
  /** A quiet line under it ("2 shifts", "from 4.5 h"). */
  note?: string;
}

/** The tooltip as plain words, for the live region a screen reader hears. */
export const tipText = (t: Tip) =>
  [t.title, t.value, ...(t.rows ?? []).map((r) => `${r.label} ${r.value}`), t.note]
    .filter(Boolean)
    .join(', ');

/**
 * The tooltip over a plot (Material's plain tooltip: inverse-surface, extra-small corners), at
 * `x` across and `y` down inside the plot's box, kept inside it. It never takes the pointer.
 */
export function ChartTooltip({
  tip,
  x,
  y,
  width,
}: {
  tip: Tip | null;
  x: number;
  y: number;
  width: number;
}) {
  if (!tip) return null;
  const align = x < width * 0.25 ? 'start' : x > width * 0.75 ? 'end' : 'center';
  return (
    <div
      role="tooltip"
      data-testid="chart-tooltip"
      className="pointer-events-none absolute z-10 w-max max-w-56 rounded-extra-small bg-inverse-surface px-2.5 py-1.5 text-body-small text-inverse-on-surface shadow-elevation-2"
      style={{
        left: x,
        top: Math.max(0, y),
        transform: `translate(${align === 'start' ? '-12px' : align === 'end' ? 'calc(-100% + 12px)' : '-50%'}, -100%)`,
      }}
    >
      {tip.value ? <div className="text-label-large tabular-nums">{tip.value}</div> : null}
      <div className="opacity-80">{tip.title}</div>
      {tip.rows?.length ? (
        <ul className="mt-1 space-y-0.5">
          {tip.rows.map((r) => (
            <li key={r.label} className="flex items-center gap-1.5 tabular-nums">
              {r.color ? (
                <span
                  aria-hidden
                  className="h-0.5 w-3 rounded-full"
                  style={{ background: r.color }}
                />
              ) : null}
              <span className="font-medium">{r.value}</span>
              <span className="opacity-80">{r.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {tip.note ? <div className="mt-0.5 opacity-80">{tip.note}</div> : null}
    </div>
  );
}

/**
 * Which slot of a chart is active, from the pointer or the keyboard: the plot is one tab stop,
 * the arrow keys (and Home and End) move between slots, Escape lets go. `usable` skips slots with
 * nothing to read (a day still to come).
 */
export function useActive(count: number, usable: (i: number) => boolean = () => true) {
  const [active, setActive] = useState<number | null>(null);
  const indices = Array.from({ length: count }, (_, i) => i).filter(usable);
  const move = (dir: 1 | -1) => {
    if (indices.length === 0) return;
    const from = active ?? (dir === 1 ? -1 : count);
    const next =
      dir === 1 ? indices.find((i) => i > from) : [...indices].reverse().find((i) => i < from);
    setActive(next ?? active ?? indices[0]!);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowRight: () => move(1),
      ArrowDown: () => move(1),
      ArrowLeft: () => move(-1),
      ArrowUp: () => move(-1),
      Home: () => setActive(indices[0] ?? null),
      End: () => setActive(indices.at(-1) ?? null),
      Escape: () => setActive(null),
    };
    const run = keys[e.key];
    if (run) {
      e.preventDefault();
      run();
    }
  };
  return {
    active,
    setActive,
    focusProps: {
      tabIndex: 0,
      onKeyDown,
      onFocus: () => setActive((a) => a ?? indices[0] ?? null),
      onBlur: () => setActive(null),
    },
  };
}

/** The live region that reads the active slot to a screen reader as the keyboard moves. */
export function LiveTip({ tip }: { tip: Tip | null }) {
  return (
    <div className="sr-only" aria-live="polite">
      {tip ? tipText(tip) : ''}
    </div>
  );
}

/**
 * The width of the element, kept up to date (ResizeObserver), so a chart draws to its box. jsdom
 * measures nothing; `fallback` is used then.
 */
export function useWidth<T extends HTMLElement>(fallback = 600) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(el.clientWidth);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width > 0 ? width : fallback] as const;
}

/** A chart still loading: bars of the plot's height in the skeleton colour, never a spinner. */
export function ChartSkeleton({ height = 160, bars = 12 }: { height?: number; bars?: number }) {
  const heights = [40, 65, 30, 80, 55, 70, 25, 60, 85, 45, 50, 35];
  return (
    <div aria-busy="true" aria-label="Loading the chart" className="space-y-3">
      <Skeleton className="h-8 w-56 rounded-full" />
      <div className="flex items-end gap-2" style={{ height }}>
        {Array.from({ length: bars }, (_, i) => (
          <Skeleton
            key={i}
            className="flex-1 rounded-b-none"
            style={{ height: `${heights[i % heights.length]}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/** No data for a chart: what it would show and one way forward. */
export function ChartEmpty({ children }: { children: ReactNode }) {
  return <EmptyState className="p-6">{children}</EmptyState>;
}
