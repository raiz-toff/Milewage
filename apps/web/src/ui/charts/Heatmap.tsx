import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { tint } from './colors';
import { ChartTooltip, LiveTip, useWidth } from './frame';
import type { Tip } from './frame';
import { binOf, valueAxis } from './scale';

export interface HeatCell {
  /** The value the colour shows; null when there is nothing to show (no time worked there). */
  value: number | null;
  tip: Tip;
}

/**
 * How much of the colour each of the five steps keeps, light to dark. Validated as an ordinal ramp
 * (data-viz validator) for `chart-earned` and `chart-measure` in both themes: monotone lightness,
 * steps at least 0.06 apart, the light end at 2:1 or more on the card.
 */
export const HEAT_STEPS = [48, 61, 74, 87, 100];

/**
 * A grid of cells, rows by columns (weekdays by hours of the day), coloured on one sequential
 * hue in five equal steps from zero to a nice top; a cell with nothing to show is the muted fill.
 * The scale legend under it names the steps. One tab stop; the arrow keys move across and down,
 * and the tooltip and a live region say the cell.
 */
export function Heatmap({
  label,
  rows,
  cols,
  cells,
  color,
  format,
}: {
  label: string;
  /** Row names, short ("Mon"). */
  rows: string[];
  /** Column names, short ("6 AM"). */
  cols: string[];
  /** cells[row][col]. */
  cells: HeatCell[][];
  color: string;
  /** A value as the scale legend writes it. */
  format: (v: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<[number, number] | null>(null);
  const max = Math.max(0, ...cells.flat().map((c) => c.value ?? 0));
  const top = valueAxis(max, HEAT_STEPS.length).max;
  const fill = (v: number | null) =>
    v === null ? undefined : tint(color, HEAT_STEPS[binOf(v, top, HEAT_STEPS.length)]!);
  const head = 40;
  const cellW = (width - head) / Math.max(1, cols.length);
  const move = (dr: number, dc: number) =>
    setActive((a) => {
      const [r, c] = a ?? [0, 0];
      return [
        Math.min(rows.length - 1, Math.max(0, r + dr)),
        Math.min(cols.length - 1, Math.max(0, c + dc)),
      ];
    });
  const onKeyDown = (e: KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowRight: () => move(0, 1),
      ArrowLeft: () => move(0, -1),
      ArrowDown: () => move(1, 0),
      ArrowUp: () => move(-1, 0),
      Home: () => setActive((a) => [a?.[0] ?? 0, 0]),
      End: () => setActive((a) => [a?.[0] ?? 0, cols.length - 1]),
      Escape: () => setActive(null),
    };
    if (keys[e.key]) {
      e.preventDefault();
      keys[e.key]!();
    }
  };
  const tip = active ? cells[active[0]]![active[1]]!.tip : null;
  // Each step's lower bound, rounded off the float noise of the division (0.6, 1.2, 1.8).
  const steps = HEAT_STEPS.map((_, i) => Math.round((top / HEAT_STEPS.length) * i * 1000) / 1000);

  return (
    <div className="space-y-3">
      <div
        ref={ref}
        role="group"
        aria-roledescription="chart"
        aria-label={`${label}. Use the arrow keys to read each cell.`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((a) => a ?? [0, 0])}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
        className="relative rounded-small focus-ring"
      >
        <div
          aria-hidden
          className="grid gap-0.5"
          style={{ gridTemplateColumns: `${head}px repeat(${cols.length}, minmax(0, 1fr))` }}
        >
          {rows.map((r, ri) => (
            <div key={r} className="contents">
              <div className="flex items-center text-label-small text-on-surface-variant">{r}</div>
              {cols.map((c, ci) => {
                const cell = cells[ri]![ci]!;
                const on = active?.[0] === ri && active[1] === ci;
                return (
                  <div
                    key={c}
                    data-cell={`${ri}-${ci}`}
                    onPointerEnter={() => setActive([ri, ci])}
                    className={cn(
                      'relative h-7 rounded-[3px] sm:h-8',
                      cell.value === null &&
                        'bg-surface-container-low inset-ring inset-ring-outline-variant/60',
                      on && 'outline-2 outline-offset-1 outline-on-surface',
                    )}
                    style={{ background: fill(cell.value) }}
                  />
                );
              })}
            </div>
          ))}
          <div />
          {cols.map((c, ci) => (
            <div
              key={c}
              className="truncate pt-1 text-label-small text-on-surface-variant tabular-nums"
            >
              {cellW < 34 && ci % 2 === 1 ? '' : c}
            </div>
          ))}
        </div>
        <ChartTooltip
          tip={tip}
          x={active ? head + (active[1] + 0.5) * cellW : 0}
          y={active ? active[0] * 34 - 4 : 0}
          width={width}
        />
        <LiveTip tip={tip} />
      </div>
      {/* The scale legend: each step's lower bound, a muted swatch for the cells with nothing. */}
      <ul
        aria-hidden
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-label-medium text-on-surface-variant"
      >
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-1.5 tabular-nums">
            <span
              className="size-3 rounded-[3px]"
              style={{ background: tint(color, HEAT_STEPS[i]!) }}
            />
            {i === 0 ? `Under ${format(steps[1]!)}` : `${format(s)}+`}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded-[3px] bg-surface-container-low inset-ring inset-ring-outline-variant/60" />
          No shifts
        </li>
      </ul>
    </div>
  );
}
