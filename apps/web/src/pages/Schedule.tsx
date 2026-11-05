import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { useSession, useSettings } from '../session';
import { Button, Field, FormError } from '../ui/form';
import { localDate } from './Dashboard';

type Sched = Schemas['Schedule'];
const NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // bit 0 is Monday (18 section 9)
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The weeks of a month as rows of dates (`null` pads before and after), starting on `weekStart`. */
export function monthGrid(year: number, month: number, weekStart: number): (string | null)[][] {
  const first = Date.UTC(year, month - 1, 1);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (new Date(first).getUTCDay() - weekStart + 7) % 7;
  const cells: (string | null)[] = [
    ...Array<null>(pad).fill(null),
    ...Array.from({ length: days }, (_, i) => iso(first + i * DAY)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** Schedule (module `schedule`, off by default): plan shifts ahead, repeating templates, off days. A plan is not a record. */
export function SchedulePage() {
  const { api } = useSession();
  const { timezone, week_start: weekStart } = useSettings();
  const today = localDate(Date.now(), timezone);
  const [ym, setYm] = useState({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) });
  const [data, setData] = useState<Sched | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [times, setTimes] = useState({ start: '17:00', end: '22:00' });
  const [tpl, setTpl] = useState({ label: '', days: 0, ...{ start: '17:00', end: '22:00' } });
  const grid = monthGrid(ym.y, ym.m, weekStart);
  const from = `${ym.y}-${String(ym.m).padStart(2, '0')}-01`;
  const to = iso(Date.UTC(ym.y, ym.m, 0));

  const load = useCallback(async () => {
    try {
      setData(await unwrap<Sched>(api.GET('/schedule', { params: { query: { from, to } } })));
    } catch (e) {
      setError(describe(e));
    }
  }, [api, from, to]);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(run: () => Promise<unknown>) {
    setError(null);
    try {
      await run();
      await load();
    } catch (e) {
      setError(describe(e));
    }
  }
  const addEntry = (e: FormEvent) => {
    e.preventDefault();
    if (day)
      void act(() =>
        unwrap(
          api.POST('/schedule/entries', {
            body: { planned_on: day, start_time: times.start, end_time: times.end },
          }),
        ),
      );
  };
  const addTemplate = (e: FormEvent) => {
    e.preventDefault();
    void act(() =>
      unwrap(
        api.POST('/schedule/templates', {
          body: {
            label: tpl.label.trim(),
            weekdays: tpl.days,
            start_time: tpl.start,
            end_time: tpl.end,
          },
        }),
      ),
    ).then(() => setTpl({ ...tpl, label: '' }));
  };
  const offOn = new Set(data?.off_days.map((d) => d.off_on));
  const shift = (n: number) =>
    setYm((v) => ({
      y: v.y + Math.floor((v.m - 1 + n) / 12),
      m: ((((v.m - 1 + n) % 12) + 12) % 12) + 1,
    }));

  return (
    <section className="space-y-6">
      <h1 className="font-heading text-2xl">Schedule</h1>
      <FormError message={error} />
      <div className="flex items-center gap-3">
        <button type="button" aria-label="Previous month" onClick={() => shift(-1)}>
          ‹
        </button>
        <span className="font-mono">{from.slice(0, 7)}</span>
        <button type="button" aria-label="Next month" onClick={() => shift(1)}>
          ›
        </button>
        <button
          type="button"
          className="rounded border border-line px-3 py-1 text-sm"
          onClick={() =>
            void act(() => unwrap(api.POST('/schedule/expand', { body: { from, to } })))
          }
        >
          Fill this month from templates
        </button>
      </div>
      <table className="w-full max-w-3xl table-fixed border-collapse text-sm">
        <caption className="sr-only">Planned shifts</caption>
        <thead className="text-muted">
          <tr>
            {Array.from({ length: 7 }, (_, i) => (
              <th key={i} className="font-normal">
                {NAMES[(weekStart + 6 + i) % 7]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((week, w) => (
            <tr key={w}>
              {week.map((d, i) => (
                <td key={i} className="h-20 border border-line align-top">
                  {d ? (
                    <div>
                      <button
                        type="button"
                        aria-label={`Plan ${d}`}
                        aria-pressed={day === d}
                        className="block w-full text-left text-muted"
                        onClick={() => setDay(d)}
                      >
                        {Number(d.slice(8))}
                        {offOn.has(d) ? ' (off)' : ''}
                      </button>
                      {data?.entries
                        .filter((x) => x.planned_on === d)
                        .map((x) => (
                          <div key={x.id} className="flex justify-between text-xs">
                            <span>
                              {x.start_time}-{x.end_time}
                            </span>
                            <button
                              type="button"
                              aria-label={`Remove ${d} ${x.start_time}`}
                              onClick={() =>
                                void act(() =>
                                  unwrap(
                                    api.DELETE('/schedule/entries/{id}', {
                                      params: { path: { id: x.id } },
                                    }),
                                  ),
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
      {day ? (
        <form className="flex flex-wrap items-end gap-3" onSubmit={addEntry}>
          <span className="font-mono">{day}</span>
          <Field
            label="From"
            type="time"
            value={times.start}
            onChange={(e) => setTimes({ ...times, start: e.target.value })}
          />
          <Field
            label="To"
            type="time"
            value={times.end}
            onChange={(e) => setTimes({ ...times, end: e.target.value })}
          />
          <Button type="submit">Plan a shift</Button>
          <button
            type="button"
            className="rounded border border-line px-3 py-2"
            onClick={() =>
              void act(() =>
                offOn.has(day)
                  ? unwrap(
                      api.DELETE('/schedule/off-days/{date}', { params: { path: { date: day } } }),
                    )
                  : unwrap(
                      api.PUT('/schedule/off-days/{date}', {
                        params: { path: { date: day } },
                        body: {},
                      }),
                    ),
              )
            }
          >
            {offOn.has(day) ? 'Not an off day' : 'Mark as off day'}
          </button>
        </form>
      ) : null}
      <section aria-label="Templates" className="space-y-2">
        <h2 className="font-heading text-lg">Repeating shifts</h2>
        <ul className="text-sm">
          {data?.templates.map((t) => (
            <li key={t.id} className="flex gap-3">
              <span>
                {t.label}: {NAMES.filter((_, i) => t.weekdays & (1 << i)).join(' ')} {t.start_time}-
                {t.end_time}
              </span>
              <button
                type="button"
                aria-label={`Delete template ${t.label}`}
                className="text-muted"
                onClick={() =>
                  void act(() =>
                    unwrap(
                      api.DELETE('/schedule/templates/{id}', { params: { path: { id: t.id } } }),
                    ),
                  )
                }
              >
                Delete
              </button>
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
                checked={(tpl.days & (1 << i)) !== 0}
                onChange={() => setTpl({ ...tpl, days: tpl.days ^ (1 << i) })}
              />
              {n}
            </label>
          ))}
          <Field
            label="Template from"
            type="time"
            value={tpl.start}
            onChange={(e) => setTpl({ ...tpl, start: e.target.value })}
          />
          <Field
            label="Template to"
            type="time"
            value={tpl.end}
            onChange={(e) => setTpl({ ...tpl, end: e.target.value })}
          />
          <Button type="submit" busy={tpl.label.trim() === '' || tpl.days === 0}>
            Add repeating shift
          </Button>
        </form>
      </section>
      <p className="max-w-xl text-sm text-muted">
        A plan is not a record: what you work is recorded by the shifts themselves.
      </p>
    </section>
  );
}
