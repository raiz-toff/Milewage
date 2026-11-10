import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Section } from './layout';

export interface MoreRow {
  key: string;
  title: string;
  hint: string;
  open?: boolean;
  body: ReactNode;
}

/**
 * The quieter tools of a shift with little in it (odometer, notes, export), each folded under
 * its name so the page is not a column of empty cards (progressive disclosure).
 */
export function MoreCard({
  rows,
  label = 'More',
  title = 'More for this shift',
}: {
  rows: MoreRow[];
  label?: string;
  title?: string;
}) {
  return (
    <Section label={label} title={title}>
      <div className="-mt-2 divide-y divide-outline-variant">
        {rows.map((r) => (
          <details key={r.key} open={r.open} className="group">
            <summary className="relative -mx-2 flex cursor-pointer list-none items-center justify-between gap-3 rounded-small px-2 py-3 state-layer focus-ring [&::-webkit-details-marker]:hidden">
              <span className="min-w-0">
                <span className="block text-title-small text-on-surface">{r.title}</span>
                <span className="block truncate text-body-small text-on-surface-variant">
                  {r.hint}
                </span>
              </span>
              <ChevronDown
                aria-hidden="true"
                className="size-5 shrink-0 text-on-surface-variant transition-transform duration-200 ease-standard group-open:rotate-180"
              />
            </summary>
            <div className="pb-4">{r.body}</div>
          </details>
        ))}
      </div>
    </Section>
  );
}
