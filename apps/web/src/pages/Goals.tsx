import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { EmptyState, PageHeader, Section } from '../ui/layout';
import { Pause, Play, Trash2 } from 'lucide-react';
import { RowMenu } from '../ui/RowMenu';
import type { FormEvent } from 'react';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { formatMoney } from '../format';
import { useSession, useSettings } from '../session';
import { Button, Field, FormError, SelectField } from '../ui/form';
import { toCents } from './ShiftEarnings';

type Goal = Schemas['Goal'];
const METRICS = [
  { value: 'earnings', label: 'Earnings' },
  { value: 'hours', label: 'Hours worked' },
  { value: 'shifts', label: 'Shifts' },
  { value: 'active_distance', label: 'Active distance (estimated)' },
];
const PERIODS = ['daily', 'weekly', 'monthly', 'yearly'].map((v) => ({ value: v, label: v }));

/** Target typed by the driver to the stored unit: cents, minutes, a count or metres. */
export function targetOf(metric: string, text: string, unit: 'km' | 'mi'): number {
  const n = Number(text.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return NaN;
  if (metric === 'earnings') return toCents(text);
  if (metric === 'hours') return Math.round(n * 60);
  if (metric === 'active_distance') return Math.round(n * (unit === 'km' ? 1000 : 1609.344));
  return Math.round(n);
}

/** Shows a value in the unit the driver typed it in. */
export function valueText(metric: string, v: number, unit: 'km' | 'mi', currency: string): string {
  if (metric === 'earnings') return formatMoney(v, currency);
  if (metric === 'hours') return `${(v / 60).toFixed(1)} h`;
  if (metric === 'active_distance')
    return `${(v / (unit === 'km' ? 1000 : 1609.344)).toFixed(1)} ${unit}`;
  return String(v);
}

/** A progress bar, also the "ring" of the dashboard card; null progress is "unknown", not an empty bar. */
export function GoalBar({ goal }: { goal: Goal }) {
  const { distance_unit: unit, currency } = useSettings();
  const p = goal.progress;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="font-medium">{goal.label}</span>
        <span className="text-muted-foreground">
          {p.value === null
            ? (p.note ?? 'unknown')
            : `${valueText(goal.metric, p.value, unit, currency)} of ${valueText(goal.metric, p.target, unit, currency)}${p.estimated ? ' (estimated)' : ''}`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${goal.label} progress`}
        aria-valuenow={p.ratio === null ? undefined : Math.round(p.ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-1 h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-2 rounded-full bg-primary"
          style={{ width: `${Math.min(100, (p.ratio ?? 0) * 100)}%` }}
        />
      </div>
    </div>
  );
}

/** Goals (module `goals`, 18 section 8.1). */
export function GoalsPage() {
  const { api } = useSession();
  const { distance_unit: unit } = useSettings();
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ label: '', metric: 'earnings', period: 'weekly', target: '' });

  const load = useCallback(async () => {
    try {
      setGoals(await unwrap<Goal[]>(api.GET('/goals')));
    } catch (e) {
      setError(describe(e));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    const target = targetOf(form.metric, form.target, unit);
    if (!Number.isFinite(target)) return setError('Enter a target above zero.');
    setError(null);
    try {
      await unwrap(
        api.POST('/goals', {
          body: {
            ...form,
            target,
            metric: form.metric as Goal['metric'],
            period: form.period as Goal['period'],
          },
        }),
      );
      setForm({ ...form, label: '', target: '' });
      await load();
    } catch (err) {
      setError(describe(err));
    }
  }
  async function act(run: () => Promise<unknown>) {
    setError(null);
    try {
      await run();
      await load();
    } catch (err) {
      setError(describe(err));
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader title="Goals" description="A goal is a number you choose; none is set for you." />
      <FormError message={error} />
      <Section title="Add a goal">
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
          onSubmit={(e) => void add(e)}
        >
          <Field
            label="Name"
            maxLength={60}
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
          <SelectField
            label="Measure"
            value={form.metric}
            onChange={(v) => setForm({ ...form, metric: v })}
            options={METRICS}
          />
          <SelectField
            label="Per"
            value={form.period}
            onChange={(v) => setForm({ ...form, period: v })}
            options={PERIODS}
          />
          <Field
            label="Target"
            inputMode="decimal"
            value={form.target}
            onChange={(e) => setForm({ ...form, target: e.target.value })}
          />
          <div className="flex items-end">
            <Button type="submit" busy={form.label.trim() === ''}>
              Add goal
            </Button>
          </div>
        </form>
      </Section>
      {goals === null ? (
        <p className="text-sm text-muted-foreground">Loading</p>
      ) : goals.length === 0 ? (
        <EmptyState>No goals yet.</EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {goals.map((g) => (
            <li key={g.id} className="space-y-3 rounded-xl border bg-card p-4">
              <GoalBar goal={g} />
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="secondary">{g.period}</Badge>
                {g.active ? null : <Badge variant="outline">paused</Badge>}
                <span className="flex-1" />
                <RowMenu
                  name={g.label}
                  actions={[
                    {
                      label: g.active ? 'Pause' : 'Resume',
                      icon: g.active ? Pause : Play,
                      onSelect: () =>
                        void act(() =>
                          unwrap(
                            api.PATCH('/goals/{id}', {
                              params: { path: { id: g.id } },
                              body: { active: !g.active },
                            }),
                          ),
                        ),
                    },
                    {
                      label: 'Delete',
                      icon: Trash2,
                      destructive: true,
                      onSelect: () =>
                        void act(() =>
                          unwrap(api.DELETE('/goals/{id}', { params: { path: { id: g.id } } })),
                        ),
                    },
                  ]}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
