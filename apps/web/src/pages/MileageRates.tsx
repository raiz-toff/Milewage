import { useState } from 'react';
import type { FormEvent } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { DeleteIcon, EditIcon } from '@/ui/icons';
import { countryName } from '@milewage/shared';
import type { Schemas } from '../api/client';
import { errorText, useApiQuery, useChange } from '../api/query';
import { useCountries } from '../countries';
import { dateLocale, formatDay, todayIn } from '../days';
import { formatRate, parseRate, rateInput } from '../format';
import { HelpLink } from '../help';
import { settingsPatch, useSettings } from '../session';
import { SegmentedButtons } from '../ui/chips';
import { Button, CheckField, DateField, Field, FormError, SelectField } from '../ui/form';
import { EmptyState } from '../ui/layout';
import { RowMenu } from '../ui/RowMenu';

type Rate = Schemas['DatedOwnMileageRate'];
type Unit = 'km' | 'mi';

/** The rate in force on a day: the latest that starts on or before it (ADR 0007). */
export function rateOn(rates: readonly Rate[], day: string): Rate | null {
  let found: Rate | null = null;
  for (const r of rates) {
    const start = r.effective_from ?? '';
    if (start <= day && (!found || start > (found.effective_from ?? ''))) found = r;
  }
  return found;
}

const blank = (unit: Unit, today: string) => ({
  from: today,
  rate: '',
  unit,
  note: '',
  /** A second step (ADR 0012): this rate up to `first` km or miles of the year, then `after`. */
  step: false,
  first: '',
  after: '',
});

/**
 * Settings > Mileage rate (ADR 0007): which rate values your mileage, the country's or yours, and
 * your rates with the date each starts. Your rate is always called yours, never official (Q5).
 */
export function MileageRateSection() {
  const settings = useSettings();
  const { currency, distance_unit: unit, timezone, country: code } = settings;
  const country = useCountries().find((c) => c.code === code);
  // Until the list of countries is read, assume the country has rates (the common case).
  const official = country?.supports.mileage ?? true;
  const ratesQuery = useApiQuery('/own-mileage-rates');
  const rates = ratesQuery.data ?? null;
  const change = useChange();
  const error = errorText(change, ratesQuery);
  const today = todayIn(timezone);
  const locale = dateLocale(code);
  const [form, setForm] = useState(() => blank(unit, today));
  const [editing, setEditing] = useState<Rate | null>(null);
  const useOwn = settings.use_own_mileage_rate ?? false;
  const name = country?.name ?? countryName(code);

  const fromWords = (r: Rate) =>
    r.effective_from ? `From ${formatDay(r.effective_from, locale)}` : 'From the start';
  const rateWords = (r: Rate) =>
    r.threshold_units && r.cents_per_unit_after
      ? `${formatRate(r.cents_per_unit, currency)} per ${r.unit} for the first ${r.threshold_units.toLocaleString(locale)} ${r.unit}, then ${formatRate(r.cents_per_unit_after, currency)}`
      : `${formatRate(r.cents_per_unit, currency)} per ${r.unit}`;

  const inForce = rates ? rateOn(rates, today) : null;
  const next = rates?.find((r) => (r.effective_from ?? '') > today) ?? null;
  const inUse =
    settings.mileage_rate === 'yours' && inForce
      ? `In use today: your mileage rate, ${rateWords(inForce)}. It is your own figure, not an official rate.`
      : settings.mileage_rate === 'official'
        ? `In use today: the country rate for ${name}.${
            useOwn && next
              ? ` Your rate takes over on ${formatDay(next.effective_from!, locale)}.`
              : useOwn
                ? ' Add a rate below to use your own.'
                : ''
          }`
        : `No rate in use: MileWage has no country rate for ${name}. Add your rate to see a deduction.`;

  function edit(r: Rate) {
    change.setError(null);
    setEditing(r);
    setForm({
      from: r.effective_from ?? '',
      rate: rateInput(r.cents_per_unit, currency),
      unit: r.unit,
      note: r.note ?? '',
      step: r.threshold_units != null,
      first: r.threshold_units == null ? '' : String(r.threshold_units),
      after: r.cents_per_unit_after == null ? '' : rateInput(r.cents_per_unit_after, currency),
    });
  }
  function reset() {
    change.setError(null);
    setEditing(null);
    setForm(blank(unit, today));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const cents = parseRate(form.rate, currency);
    if (!Number.isFinite(cents) || cents <= 0) {
      return change.setError(`Enter your rate in ${currency} per ${form.unit}, for example 0.70.`);
    }
    // An undated rate (from before rates had dates) keeps its "from the start" until a day is chosen.
    if (!form.from && !(editing && editing.effective_from === null)) {
      return change.setError('Choose the day your rate starts.');
    }
    const first = Number(form.first);
    const after = parseRate(form.after, currency);
    if (form.step && !(Number.isInteger(first) && first > 0)) {
      return change.setError(`Enter the distance the first rate covers, in whole ${form.unit}.`);
    }
    if (form.step && !(Number.isFinite(after) && after > 0)) {
      return change.setError(`Enter the rate after ${first.toLocaleString(locale)} ${form.unit}.`);
    }
    const body = {
      effective_from: form.from || null,
      cents_per_unit: cents,
      unit: form.unit,
      note: form.note.trim() || null,
      threshold_units: form.step ? first : null,
      cents_per_unit_after: form.step ? after : null,
    };
    const done = editing
      ? await change.run((api) =>
          api.PATCH('/own-mileage-rates/{id}', { params: { path: { id: editing.id } }, body }),
        )
      : await change.run((api) => api.POST('/own-mileage-rates', { body }));
    if (done) reset();
  }

  const remove = (r: Rate) =>
    change.run((api) => api.DELETE('/own-mileage-rates/{id}', { params: { path: { id: r.id } } }));

  return (
    <Card>
      <CardContent className="space-y-6">
        <p role="status" className="text-body-large text-on-surface">
          {inUse}
        </p>
        {official ? (
          <div className="space-y-2">
            <SegmentedButtons
              label="Rate for your mileage deduction"
              value={useOwn ? 'yours' : 'country'}
              onChange={(v) =>
                void change.run(...settingsPatch({ use_own_mileage_rate: v === 'yours' }))
              }
              options={[
                { value: 'country', label: 'Country rate' },
                { value: 'yours', label: 'Your rate' },
              ]}
            />
            <p className="text-body-small text-on-surface-variant">
              Your rate replaces the country rate from the day it starts, for cars, vans and
              motorcycles. Shifts before that day keep the country rate.{' '}
              <HelpLink page="mileage-rates-and-tax">How rates are chosen</HelpLink>
            </p>
          </div>
        ) : (
          <p className="text-body-small text-on-surface-variant">
            Your rate values cars, vans and motorcycles from the day it starts.{' '}
            <HelpLink page="mileage-rates-and-tax">How rates are chosen</HelpLink>
          </p>
        )}

        <section aria-label="Your mileage rates" className="space-y-3">
          <h3 className="text-title-medium text-on-surface">Your mileage rates</h3>
          {rates === null ? null : rates.length === 0 ? (
            <EmptyState>
              No rates of your own. Add one if your employer or your accountant gave you a rate.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-outline-variant">
              {rates.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-body-large tabular-nums text-on-surface">
                      {rateWords(r)}
                      {inForce?.id === r.id ? (
                        <span className="text-body-small text-on-surface-variant"> · today</span>
                      ) : null}
                    </p>
                    <p className="truncate text-body-small text-on-surface-variant">
                      {[fromWords(r), r.note].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <RowMenu
                    name={`Actions for ${rateWords(r)}, ${fromWords(r).toLowerCase()}`}
                    actions={[
                      { label: 'Edit', icon: EditIcon, onSelect: () => edit(r) },
                      {
                        label: 'Remove',
                        icon: DeleteIcon,
                        destructive: true,
                        onSelect: () => void remove(r),
                      },
                    ]}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <form
          onSubmit={(e) => void save(e)}
          aria-label={editing ? 'Edit rate' : 'Add a rate'}
          className="space-y-3"
        >
          <h3 className="text-title-medium text-on-surface">
            {editing ? 'Edit rate' : 'Add a rate'}
          </h3>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem]">
            <DateField
              label={
                editing?.effective_from === null && !form.from
                  ? 'Starts (from the start)'
                  : 'Starts'
              }
              value={form.from}
              onChange={(v) => setForm({ ...form, from: v })}
            />
            <Field
              label={`Rate (${currency} per ${form.unit})`}
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={form.rate}
              onChange={(e) => setForm({ ...form, rate: e.target.value })}
            />
            <SelectField
              label="Unit"
              value={form.unit}
              onChange={(v) => setForm({ ...form, unit: v === 'mi' ? 'mi' : 'km' })}
              options={[
                { value: 'km', label: 'per km' },
                { value: 'mi', label: 'per mile' },
              ]}
            />
          </div>
          <CheckField
            label="A different rate after a set distance"
            checked={form.step}
            onChange={(step) => setForm({ ...form, step })}
          />
          <p className="text-body-small text-on-surface-variant">
            For a rate in two steps, like a higher rate for the first 5,000 {form.unit} of the year.
            The count starts again each tax year.
          </p>
          {form.step ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={`First rate covers (${form.unit} a year)`}
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={form.first}
                onChange={(e) => setForm({ ...form, first: e.target.value })}
              />
              <Field
                label={`Rate after that (${currency} per ${form.unit})`}
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={form.after}
                onChange={(e) => setForm({ ...form, after: e.target.value })}
              />
            </div>
          ) : null}
          <Field
            label="Note (optional)"
            hint="Where the figure comes from, for example your employer or your accountant."
            maxLength={200}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
          <FormError message={error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" busy={change.busy}>
              {editing ? 'Save changes' : 'Add rate'}
            </Button>
            {editing ? (
              <Button type="button" variant="ghost" onClick={reset}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
