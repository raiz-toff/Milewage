import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Swatch } from './frame';
import { percent } from './scale';

// The small figures: a part-to-whole bar and ranked bars. Neither has an axis; each sits beside the
// words and figures that carry its values.

export interface Part {
  key: string;
  label: string;
  value: number;
  color: string;
  /** The words beside the name ("12.3 mi"), from the app's formatters. */
  figure: string;
  /** Marks the part as an estimate: the label carries the asterisk (`Est`). */
  mark?: ReactNode;
}

/**
 * One whole split into parts, read beside its figures: a thin bar (8 px, rounded ends, 2 px
 * surface gaps, no text on it) over a list giving each part's swatch, name, figure and share.
 * The bar's accessible name says every part, so nothing depends on the colours.
 */
export function SegmentBar({ parts, label }: { parts: Part[]; label: string }) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  const shown = parts.filter((p) => p.value > 0);
  const name = `${label}: ${shown.map((p) => `${p.label} ${p.figure}, ${percent(p.value, total)}%`).join('; ')}`;
  return (
    <div className="space-y-3">
      <div role="img" aria-label={name} className="flex h-2 w-full gap-0.5">
        {shown.map((p, i) => (
          <span
            key={p.key}
            data-part={p.key}
            className={cn(
              'h-full min-w-1',
              i === 0 && 'rounded-l-full',
              i === shown.length - 1 && 'rounded-r-full',
            )}
            style={{ flexGrow: p.value, flexBasis: 0, background: p.color }}
          />
        ))}
      </div>
      <ul aria-hidden className="space-y-1.5 text-body-medium">
        {shown.map((p) => (
          <li key={p.key} className="flex items-center gap-2">
            <Swatch color={p.color} />
            <span className="min-w-0 flex-1 truncate">
              {p.label}
              {p.mark}
            </span>
            <span className="tabular-nums">{p.figure}</span>
            <span className="w-10 text-right text-on-surface-variant tabular-nums">
              {percent(p.value, total)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface Rank {
  key: string;
  /** The name, with its badge when it has one. */
  name: ReactNode;
  /** The name as words, for the accessible name. */
  text: string;
  value: number;
  figure: string;
  color: string;
}

/**
 * Parts compared with each other: one bar per part on a shared baseline, largest first, the name
 * and figure over each bar and the share after it. Bars are 8 px with rounded ends.
 */
export function RankBars({ items, label }: { items: Rank[]; label: string }) {
  const max = Math.max(0, ...items.map((r) => r.value));
  const total = items.reduce((a, r) => a + Math.max(0, r.value), 0);
  return (
    <ul aria-label={label} className="space-y-3">
      {items.map((r) => (
        <li
          key={r.key}
          aria-label={`${r.text}: ${r.figure}, ${percent(r.value, total)}%`}
          className="space-y-1.5"
        >
          <div aria-hidden className="flex items-baseline gap-3 text-body-medium">
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            <span className="tabular-nums">{r.figure}</span>
            <span className="w-10 text-right text-on-surface-variant tabular-nums">
              {percent(r.value, total)}%
            </span>
          </div>
          <div aria-hidden className="h-2">
            <div
              className="h-2 min-w-1 rounded-full"
              style={{
                width: `${max > 0 ? Math.max(0, (r.value / max) * 100) : 0}%`,
                background: r.color,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
