import { useCallback, useEffect, useState } from 'react';
import { Button as UiButton } from '@/components/ui/button';
import type { FormEvent } from 'react';
import { describe, unwrap } from '../api/client';
import { dateLocale, formatDay } from '../dateText';
import type { Schemas } from '../api/client';
import { formatMoney } from '../format';
import { useSession, useSettings } from '../session';
import { Button, DateField, Field, FormError, SelectField } from '../ui/form';
import { localDate } from './Dashboard';
import { toCents } from './ShiftEarnings';

type Log = Schemas['MaintenanceLog'];
const KINDS = [
  { value: 'oil_change', label: 'Oil change' },
  { value: 'tires', label: 'Tires' },
  { value: 'brakes', label: 'Brakes' },
  { value: 'other', label: 'Other' },
];
const label = (k: string) => KINDS.find((x) => x.value === k)?.label ?? k;

/** The service record of one vehicle (module `maintenance`, 18 section 6). */
export function VehicleMaintenance({ vehicleId, name }: { vehicleId: number; name: string }) {
  const { api } = useSession();
  const { currency, distance_unit: unit, timezone, modules, country } = useSettings();
  // The day as other dates are written ("Oct 1, 2026", or "1 Oct 2026" in GB).
  const day = (iso: string) => formatDay(iso, dateLocale(country)) || iso;
  const [logs, setLogs] = useState<Log[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    kind: 'oil_change',
    date: localDate(Date.now(), timezone),
    cost: '',
    odometer: '',
    notes: '',
  });

  const load = useCallback(async () => {
    try {
      setLogs(
        await unwrap<Log[]>(
          api.GET('/vehicles/{id}/maintenance', { params: { path: { id: vehicleId } } }),
        ),
      );
    } catch (e) {
      setError(describe(e));
    }
  }, [api, vehicleId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    const cost = toCents(form.cost);
    const odo =
      form.odometer.trim() === ''
        ? null
        : Math.round(Number(form.odometer) * (unit === 'km' ? 1000 : 1609.344));
    if (!Number.isFinite(cost) || cost < 0 || (odo !== null && !Number.isFinite(odo))) {
      return setError('Cost and odometer must be numbers, zero or more.');
    }
    setError(null);
    try {
      await unwrap(
        api.POST('/vehicles/{id}/maintenance', {
          params: { path: { id: vehicleId } },
          body: {
            kind: form.kind as Log['kind'],
            serviced_on: form.date,
            cost_cents: cost > 0 ? cost : null,
            odometer_m: odo,
            notes: form.notes.trim() === '' ? null : form.notes.trim(),
          },
        }),
      );
      setForm({ ...form, cost: '', odometer: '', notes: '' });
      await load();
    } catch (err) {
      setError(describe(err));
    }
  }
  async function remove(id: number) {
    try {
      await unwrap(api.DELETE('/maintenance/{id}', { params: { path: { id } } }));
      await load();
    } catch (err) {
      setError(describe(err));
    }
  }

  return (
    <section aria-label={`Maintenance of ${name}`} className="mt-2 space-y-2 rounded-lg border p-3">
      <FormError message={error} />
      {logs === null ? null : logs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No service entries yet.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {logs.map((l) => (
            <li key={l.id} className="flex flex-wrap gap-3">
              <span className="tabular-nums">{day(l.serviced_on)}</span>
              <span>{label(l.kind)}</span>
              {l.cost_cents === null ? null : <span>{formatMoney(l.cost_cents, currency)}</span>}
              {l.odometer_m === null ? null : (
                <span className="text-muted-foreground">
                  {Math.round(l.odometer_m / (unit === 'km' ? 1000 : 1609.344)).toLocaleString(
                    'en-CA',
                  )}{' '}
                  {unit}
                </span>
              )}
              {l.double_counts ? (
                <span className="text-muted-foreground">covered by the mileage rate</span>
              ) : null}
              <UiButton
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Delete service ${day(l.serviced_on)} ${label(l.kind)}`}
                onClick={() => void remove(l.id)}
              >
                Delete
              </UiButton>
            </li>
          ))}
        </ul>
      )}
      <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => void add(e)}>
        <SelectField
          label="Service"
          value={form.kind}
          onChange={(v) => setForm({ ...form, kind: v })}
          options={KINDS}
        />
        <DateField
          label="Service date"
          value={form.date}
          onChange={(date) => setForm({ ...form, date })}
        />
        <Field
          label={modules.expenses ? 'Cost (also saved as an expense)' : 'Cost'}
          inputMode="decimal"
          value={form.cost}
          onChange={(e) => setForm({ ...form, cost: e.target.value })}
        />
        <Field
          label={`Odometer (${unit})`}
          inputMode="decimal"
          value={form.odometer}
          onChange={(e) => setForm({ ...form, odometer: e.target.value })}
        />
        <div className="flex items-end">
          <Button type="submit">Add service</Button>
        </div>
      </form>
    </section>
  );
}
