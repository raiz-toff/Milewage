import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  label: string;
  /** What sorting compares; null sorts last in both directions. */
  sortValue: (row: T) => string | number | null;
  render: (row: T) => ReactNode;
  numeric?: boolean;
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
  const shown = useMemo(() => {
    const col = columns.find((c) => c.key === sort?.key);
    return col && sort ? sortRows(rows, col, sort.dir) : rows;
  }, [rows, columns, sort]);

  function toggle(key: string) {
    setSort((s) =>
      s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    );
  }

  return (
    <table className="w-full text-left">
      <caption className="sr-only">{caption}</caption>
      <thead className="text-sm text-muted">
        <tr>
          {columns.map((c) => (
            <th
              key={c.key}
              scope="col"
              aria-sort={
                sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
              }
              className={`pb-2 font-normal ${c.numeric ? 'text-right' : ''}`}
            >
              <button type="button" onClick={() => toggle(c.key)} className="hover:text-ink">
                {c.label}
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {shown.map((row) => (
          <tr key={rowKey(row)} className="border-t border-line">
            {columns.map((c) => (
              <td key={c.key} className={`py-2 pr-4 ${c.numeric ? 'text-right font-mono' : ''}`}>
                {c.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
