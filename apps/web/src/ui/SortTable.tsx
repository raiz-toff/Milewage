import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ReactNode } from 'react';
import { ArrowDownwardIcon, ArrowUpwardIcon, CopyIcon } from '@/ui/icons';
import { Button } from '@/components/ui/button';

export interface Column<T> {
  key: string;
  label: string;
  /** What sorting compares; null sorts last in both directions. */
  sortValue: (row: T) => string | number | null;
  render: (row: T) => ReactNode;
  /** Plain text of the cell for CSV copy; defaults to the sort value (empty when null). */
  text?: (row: T) => string;
  numeric?: boolean;
}

/** One CSV cell (RFC 4180). Text that a spreadsheet would run as a formula gets a leading quote. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) && Number.isNaN(Number(value)) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv<T>(columns: Column<T>[], rows: T[]): string {
  const cell = (c: Column<T>, r: T) => c.text?.(r) ?? String(c.sortValue(r) ?? '');
  const lines = [columns.map((c) => csvCell(c.label.replace(/\*$/, ' (estimated)'))).join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvCell(cell(c, r))).join(','));
  return lines.join('\r\n') + '\r\n';
}

/** Order rows by a column; ties keep their original order, nulls always go last. */
export function sortRows<T>(rows: T[], col: Column<T>, dir: 'asc' | 'desc'): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: col.sortValue(row) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) return a.v === b.v ? a.i - b.i : a.v === null ? 1 : -1;
      const c = a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
      return c ? c * sign : a.i - b.i;
    })
    .map((x) => x.row);
}

export function SortTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  initialSort,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  caption: string;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [copied, setCopied] = useState<string | null>(null);
  const body = useRef<HTMLTableSectionElement>(null);
  const shown = useMemo(() => {
    const col = columns.find((c) => c.key === sort?.key);
    return col && sort ? sortRows(rows, col, sort.dir) : rows;
  }, [rows, columns, sort]);

  function toggle(key: string) {
    setSort((s) =>
      s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    );
  }

  /** Up/Down/Home/End move between rows; Enter follows the row's first link. */
  function onKeyDown(e: KeyboardEvent<HTMLTableSectionElement>) {
    const rowEls = [...(body.current?.querySelectorAll<HTMLElement>('tr') ?? [])];
    const at = rowEls.indexOf((e.target as HTMLElement).closest('tr') as HTMLElement);
    if (at < 0) return;
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: rowEls.length - 1 }[e.key];
    if (to !== undefined) {
      e.preventDefault();
      rowEls[Math.min(Math.max(to, 0), rowEls.length - 1)]?.focus();
    } else if (e.key === 'Enter') {
      rowEls[at]?.querySelector<HTMLElement>('a,button')?.click();
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(toCsv(columns, shown));
      setCopied(`Copied ${shown.length} rows as CSV.`);
    } catch {
      setCopied('Copy was blocked by the browser.');
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-3 text-body-medium">
        {copied ? (
          <span role="status" className="text-on-surface-variant">
            {copied}
          </span>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={() => void copy()}>
          <CopyIcon />
          Copy CSV
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-outline-variant">
        <table className="w-full text-left text-body-medium">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface-container text-on-surface-variant">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={
                    sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                  className={`h-12 px-4 text-title-small whitespace-nowrap ${c.numeric ? 'text-right' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(c.key)}
                    className="inline-flex items-center gap-1 rounded-extra-small focus-ring hover:text-on-surface"
                  >
                    {c.label}
                    {sort?.key === c.key ? (
                      sort.dir === 'asc' ? (
                        <ArrowUpwardIcon className="size-[18px]" />
                      ) : (
                        <ArrowDownwardIcon className="size-[18px]" />
                      )
                    ) : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody ref={body} onKeyDown={onKeyDown}>
            {shown.map((row, i) => (
              <tr
                key={rowKey(row)}
                tabIndex={i === 0 ? 0 : -1}
                className="border-t border-outline-variant transition-colors outline-none hover:bg-on-surface/8 focus-visible:bg-on-surface/10 focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-ring"
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`h-[52px] px-4 py-1.5 ${c.numeric ? 'text-right whitespace-nowrap tabular-nums' : ''}`}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
