import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { EmptyState, PageHeader, Section } from '../ui/layout';
import { DeleteIcon, EditIcon, PauseIcon, PlayIcon } from '@/ui/icons';
import { RowMenu } from '../ui/RowMenu';
import type { FormEvent } from 'react';
import { errorText, useApiQuery, useChange } from '../api/query';
import type { Schemas } from '../api/client';
import { Button as UiButton } from '@/components/ui/button';
import { targetInput, targetOf, valueText } from '../goals';
import { useSettings } from '../session';
import { Button, Field, FormError, SelectField } from '../ui/form';

type Goal = Schemas['Goal'];
const METRICS = [
  { value: 'earnings', label: 'Earnings' },
  { value: 'hours', label: 'Hours worked' },
  { value: 'shifts', label: 'Shifts' },
  { value: 'active_distance', label: 'Active distance (estimated)' },
];
const PERIODS = ['daily', 'weekly', 'monthly', 'yearly'].map((v) => ({ value: v, label: v }));
const EMPTY = { label: '', metric: 'earnings', period: 'weekly', target: '' };

/** A progress bar, also the "ring" of the dashboard card; null progress is "unknown", not an empty bar. */
export function GoalBar({ goal }: { goal: Goal }) {
  const { distance_unit: unit, currency } = useSettings();
  const p = goal.progress;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-title-medium">{goal.label}</span>
        <span className="text-body-medium text-muted-foreground tabular-nums">
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
        className="mt-1 h-2 overflow-hidden rounded-full bg-secondary-container"
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
  const { distance_unit: unit, currency } = useSettings();
  const asked = useApiQuery('/goals');
  const goals = asked.data ?? null;
  const change = useChange();
  const error = errorText(change, asked);
  const [form, setForm] = useState(EMPTY);
  // The id of the goal the form edits; null while it adds one. The same form serves both.
  const [editing, setEditing] = useState<number | null>(null);

  function edit(g: Goal) {
    change.setError(null);
    setEditing(g.id);
    setForm({
      label: g.label,
      metric: g.metric,
      period: g.period,
      target: targetInput(g.metric, g.target, unit, currency),
    });
  }
  // Leaving an edit empties the form back to the add defaults, not the edited goal's choices.
  function cancel() {
    setEditing(null);
    setForm(EMPTY);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const target = targetOf(form.metric, form.target, unit, currency);
    if (!Number.isFinite(target)) return change.setError('Enter a target above zero.');
    const body = {
      ...form,
      label: form.label.trim(),
      target,
      metric: form.metric as Goal['metric'],
      period: form.period as Goal['period'],
    };
    if (editing === null) {
      if (await change.run((api) => api.POST('/goals', { body })))
        setForm({ ...form, label: '', target: '' });
    } else if (
      await change.run((api) =>
        api.PATCH('/goals/{id}', { params: { path: { id: editing } }, body }),
      )
    ) {
      cancel();
    }
  }

  return (
    <section className="space-y-6">
      <PageHeader title="Goals" description="A goal is a number you choose; none is set for you." />
      <FormError message={error} />
      <Section title={editing === null ? 'Add a goal' : 'Edit goal'}>
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
          onSubmit={(e) => void save(e)}
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
          <div className="flex items-end gap-2">
            <Button type="submit" busy={form.label.trim() === ''}>
              {editing === null ? 'Add goal' : 'Save changes'}
            </Button>
            {editing === null ? null : (
              <UiButton type="button" variant="ghost" onClick={cancel}>
                Cancel
              </UiButton>
            )}
          </div>
        </form>
      </Section>
      {goals === null ? (
        <p className="text-body-medium text-muted-foreground">Loading</p>
      ) : goals.length === 0 ? (
        <EmptyState>No goals yet.</EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {goals.map((g) => (
            <li key={g.id} className="space-y-3 rounded-medium bg-card p-4">
              <GoalBar goal={g} />
              <div className="flex items-center gap-2 text-body-medium text-muted-foreground">
                <Badge variant="secondary">{g.period}</Badge>
                {g.active ? null : <Badge variant="outline">paused</Badge>}
                <span className="flex-1" />
                <RowMenu
                  name={g.label}
                  actions={[
                    { label: 'Edit', icon: EditIcon, onSelect: () => edit(g) },
                    {
                      label: g.active ? 'Pause' : 'Resume',
                      icon: g.active ? PauseIcon : PlayIcon,
                      onSelect: () =>
                        void change.run((api) =>
                          api.PATCH('/goals/{id}', {
                            params: { path: { id: g.id } },
                            body: { active: !g.active },
                          }),
                        ),
                    },
                    {
                      label: 'Delete',
                      icon: DeleteIcon,
                      destructive: true,
                      onSelect: () => {
                        // The form must not go on editing a goal that is gone.
                        if (editing === g.id) cancel();
                        void change.run((api) =>
                          api.DELETE('/goals/{id}', { params: { path: { id: g.id } } }),
                        );
                      },
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
