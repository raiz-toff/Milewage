import { useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PageHeader, Section } from '../ui/layout';
import { Button as UiButton } from '@/components/ui/button';
import type { FormEvent } from 'react';
import { errorText, useApiQuery, useChange } from '../api/query';
import { useSettings } from '../session';
import { formatClock } from '../format';
import { Button, Field, FormError, TimeField } from '../ui/form';
import { monthGrid, period, todayIn } from '../days';

const NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // bit 0 is Monday (18 section 9)
/** Schedule (module `schedule`, off by default): plan shifts ahead, repeating templates, off days. A plan is not a record. */
export function SchedulePage() {
  const { timezone, week_start: weekStart, time_format: timeFormat } = useSettings();
  const today = todayIn(timezone);
  const [ym, setYm] = useState({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) });
  const [day, setDay] = useState<string | null>(null);
  const [times, setTimes] = useState({ start: '17:00', end: '22:00' });
  const [tpl, setTpl] = useState({ label: '', days: 0, ...{ start: '17:00', end: '22:00' } });
  const grid = monthGrid(ym.y, ym.m, weekStart);
  const { from, to } = period('month', `${ym.y}-${String(ym.m).padStart(2, '0')}-01`, weekStart);

  // The month shown stays while the next one is read.
  const asked = useApiQuery(
    '/schedule',
    { params: { query: { from, to } } },
    { placeholderData: keepPreviousData },
  );
  const data = asked.data ?? null;
  const change = useChange();
  const error = errorText(change, asked);
  const addEntry = (e: FormEvent) => {
    e.preventDefault();
    if (day)
      void change.run((api) =>
        api.POST('/schedule/entries', {
          body: { planned_on: day, start_time: times.start, end_time: times.end },
        }),
      );
  };
  const addTemplate = (e: FormEvent) => {
    e.preventDefault();
    void change
      .run((api) =>
        api.POST('/schedule/templates', {
          body: {
            label: tpl.label.trim(),
            weekdays: tpl.days,
            start_time: tpl.start,
            end_time: tpl.end,
          },
        }),
      )
      .then(() => setTpl({ ...tpl, label: '' }));
  };
  const offOn = new Set(data?.off_days.map((d) => d.off_on));
  const shift = (n: number) =>
    setYm((v) => ({
      y: v.y + Math.floor((v.m - 1 + n) / 12),
      m: ((((v.m - 1 + n) % 12) + 12) % 12) + 1,
    }));

  return (
    <section className="space-y-6">
      <PageHeader
        title="Schedule"
        description="A plan is not a record: what you work is recorded by the shifts themselves."
      />
      <FormError message={error} />
      <Section>
        <div className="flex flex-wrap items-center gap-2">
          <UiButton
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Previous month"
            onClick={() => shift(-1)}
          >
            <ChevronLeft />
          </UiButton>
          <span className="min-w-20 text-center font-medium tabular-nums">{from.slice(0, 7)}</span>
          <UiButton
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Next month"
            onClick={() => shift(1)}
          >
            <ChevronRight />
          </UiButton>
          <span className="flex-1" />
          <UiButton
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              void change.run((api) => api.POST('/schedule/expand', { body: { from, to } }))
            }
          >
            Fill this month from templates
          </UiButton>
        </div>
        <table className="w-full table-fixed border-separate border-spacing-1 text-sm">
          <caption className="sr-only">Planned shifts</caption>
          <thead className="text-muted-foreground">
            <tr>
              {Array.from({ length: 7 }, (_, i) => (
                <th key={i} className="pb-1 text-xs font-medium">
                  {NAMES[(weekStart + 6 + i) % 7]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((week, w) => (
              <tr key={w}>
                {week.map((d, i) => (
                  <td
                    key={i}
                    className={`h-24 rounded-lg align-top ${d ? (day === d ? 'bg-primary/15 ring-1 ring-primary' : offOn.has(d) ? 'bg-muted' : 'border bg-card') : ''}`}
                  >
                    {d ? (
                      <div className="space-y-1 p-1.5">
                        <button
                          type="button"
                          aria-label={`Plan ${d}`}
                          aria-pressed={day === d}
                          className="block w-full rounded text-left text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setDay(d)}
                        >
                          {Number(d.slice(8))}
                          {offOn.has(d) ? ' (off)' : ''}
                        </button>
                        {data?.entries
                          .filter((x) => x.planned_on === d)
                          .map((x) => (
                            <div
                              key={x.id}
                              className="flex items-center justify-between rounded bg-primary px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground"
                            >
                              <span>
                                {formatClock(x.start_time, timeFormat)}-
                                {formatClock(x.end_time, timeFormat)}
                              </span>
                              <button
                                type="button"
                                aria-label={`Remove ${d} ${x.start_time}`}
                                onClick={() =>
                                  void change.run((api) =>
                                    api.DELETE('/schedule/entries/{id}', {
                                      params: { path: { id: x.id } },
                                    }),
                                  )
                                }
                              >
                                ×
                              </button>
                            </div>
                          ))}
                      </div>
                    ) : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      {day ? (
        <Section title={`Plan ${day}`}>
          <form className="flex flex-wrap items-end gap-3" onSubmit={addEntry}>
            <TimeField
              label="From"
              timeFormat={timeFormat}
              value={times.start}
              onChange={(v) => setTimes({ ...times, start: v })}
            />
            <TimeField
              label="To"
              timeFormat={timeFormat}
              value={times.end}
              onChange={(v) => setTimes({ ...times, end: v })}
            />
            <Button type="submit">Plan a shift</Button>
            <UiButton
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                void change.run(async (api) =>
                  offOn.has(day)
                    ? await api.DELETE('/schedule/off-days/{date}', {
                        params: { path: { date: day } },
                      })
                    : await api.PUT('/schedule/off-days/{date}', {
                        params: { path: { date: day } },
                        body: {},
                      }),
                )
              }
            >
              {offOn.has(day) ? 'Not an off day' : 'Mark as off day'}
            </UiButton>
          </form>
        </Section>
      ) : null}
      <Section label="Templates" title="Repeating shifts">
        <ul className="divide-y text-sm">
          {data?.templates.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-1.5">
              <span>
                {t.label}: {NAMES.filter((_, i) => t.weekdays & (1 << i)).join(' ')}{' '}
                {formatClock(t.start_time, timeFormat)}-{formatClock(t.end_time, timeFormat)}
              </span>
              <UiButton
                type="button"
                aria-label={`Delete template ${t.label}`}
                variant="ghost"
                size="sm"
                onClick={() =>
                  void change.run((api) =>
                    api.DELETE('/schedule/templates/{id}', { params: { path: { id: t.id } } }),
                  )
                }
              >
                Delete
              </UiButton>
            </li>
          ))}
        </ul>
        <form className="flex flex-wrap items-end gap-3" onSubmit={addTemplate}>
          <Field
            label="Name"
            value={tpl.label}
            maxLength={60}
            onChange={(e) => setTpl({ ...tpl, label: e.target.value })}
          />
          {NAMES.map((n, i) => (
            <label key={n} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={(tpl.days & (1 << i)) !== 0}
                onChange={() => setTpl({ ...tpl, days: tpl.days ^ (1 << i) })}
              />
              {n}
            </label>
          ))}
          <TimeField
            label="Template from"
            timeFormat={timeFormat}
            value={tpl.start}
            onChange={(v) => setTpl({ ...tpl, start: v })}
          />
          <TimeField
            label="Template to"
            timeFormat={timeFormat}
            value={tpl.end}
            onChange={(v) => setTpl({ ...tpl, end: v })}
          />
          <Button type="submit" busy={tpl.label.trim() === '' || tpl.days === 0}>
            Add repeating shift
          </Button>
        </form>
      </Section>
    </section>
  );
}
