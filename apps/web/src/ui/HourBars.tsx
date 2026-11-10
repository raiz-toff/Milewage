import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { EmptyState, tableClass } from './layout';
import type { TimeFormat } from '../format';

export interface HourBar {
  /** 0 to 23. */
  hour: number;
  value: number;
}

/** "17:00", or "5 PM" with the 12h setting: the short form an axis has room for. */
export function hourLabel(hour: number, timeFormat: TimeFormat): string {
  if (timeFormat === '24h') return `${String(hour).padStart(2, '0')}:00`;
  return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'AM' : 'PM'}`;
}

/**
 * A small column chart of one count per hour of the day, drawn with CSS so no chart library is
 * needed. One series, so the section title names it and there is no legend. The bars wear the
 * chart token, text wears the text tokens. Only the busiest hour is labelled on the chart;
 * hovering a column shows its value above the chart. The numbers are also in a table: hidden
 * from sight (a screen reader always gets it, the columns are hidden from it) until "Show as a
 * table" shows it, so every value can be read without a pointer.
 */
export function HourBars({
  label,
  unit,
  bars,
  timeFormat,
  emptyText,
}: {
  /** What the bars count, as the table's caption ("Shifts by start hour"). */
  label: string;
  /** Singular and plural of the unit ("shift", "shifts"). */
  unit: [string, string];
  /** Hours left out count as 0; hours outside 0 to 23 are ignored. */
  bars: HourBar[];
  timeFormat: TimeFormat;
  emptyText: string;
}) {
  const tableId = useId();
  const [showTable, setShowTable] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const hours = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    value: bars.find((b) => b.hour === hour)?.value ?? 0,
  }));
  const max = Math.max(...hours.map((b) => b.value));
  if (max <= 0) return <EmptyState>{emptyText}</EmptyState>;
  const count = (n: number) => `${n} ${n === 1 ? unit[0] : unit[1]}`;
  const shown = hovered === null ? null : hours[hovered]!;
  return (
    <div className="space-y-2">
      <div className="flex min-h-8 items-center justify-between gap-3 text-body-medium">
        {/* The hover readout: the value leads, the hour follows. The table carries it for a screen reader. */}
        <p aria-hidden data-testid="hour-readout" className="tabular-nums">
          {shown ? (
            <>
              <span className="text-title-small">{count(shown.value)}</span>{' '}
              <span className="text-on-surface-variant">
                at {hourLabel(shown.hour, timeFormat)}
              </span>
            </>
          ) : null}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={showTable}
          aria-controls={tableId}
          onClick={() => setShowTable(!showTable)}
        >
          {showTable ? 'Hide table' : 'Show as a table'}
        </Button>
      </div>
      <div aria-hidden className="flex gap-0.5 pt-5" onPointerLeave={() => setHovered(null)}>
        {hours.map((b) => {
          const pct = (b.value / max) * 100;
          return (
            // The whole column and its tick band are the hover target, not only the painted bar.
            <div
              key={b.hour}
              data-hour={b.hour}
              className="min-w-0 flex-1"
              onPointerEnter={() => setHovered(b.hour)}
            >
              <div className="relative flex h-24 items-end justify-center border-b border-outline-variant">
                {b.value === max ? (
                  <span
                    className="absolute left-1/2 -translate-x-1/2 text-label-small text-on-surface-variant tabular-nums"
                    style={{ bottom: `calc(${pct}% + 2px)` }}
                  >
                    {b.value}
                  </span>
                ) : null}
                <div
                  className={cn(
                    'w-full max-w-6 rounded-t-extra-small bg-chart-1 transition-opacity duration-150',
                    hovered === b.hour && 'opacity-70',
                  )}
                  style={{ height: `${pct}%` }}
                />
              </div>
              {/* A tick every six hours, from the left edge of its hour, so the labels never collide. */}
              <div className="relative h-5 text-label-small text-on-surface-variant tabular-nums">
                {b.hour % 6 === 0 ? (
                  <span className="absolute top-1 left-0 whitespace-nowrap">
                    {hourLabel(b.hour, timeFormat)}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <div
        id={tableId}
        className={
          showTable ? 'overflow-x-auto rounded-xl border border-outline-variant' : 'sr-only'
        }
      >
        <table className={tableClass}>
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr>
              <th scope="col">Hour</th>
              <th scope="col" className="text-right">
                {unit[1].charAt(0).toUpperCase() + unit[1].slice(1)}
              </th>
            </tr>
          </thead>
          <tbody>
            {hours.map((b) => (
              <tr key={b.hour}>
                <th scope="row">{hourLabel(b.hour, timeFormat)}</th>
                <td className="text-right tabular-nums">{b.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
