import { useId } from 'react';
import { notAutomobile } from '@milewage/shared';
import type { Schemas } from '../api/client';
import { put, useApiQuery, useChange } from '../api/query';
import { useSettings } from '../session';
import { todayIn } from '../days';
import { Picker } from '../ui/form';

type Row = Schemas['VehicleTaxYear'];

/**
 * How one vehicle is deducted this year (module `tax`, 18 section 7.1): mileage rate or actual
 * expenses, with one line on what each means. A type with no mileage rate says so.
 */
export function VehicleTaxYear({
  vehicleId,
  name,
  kind,
}: {
  vehicleId: number;
  name: string;
  kind: Schemas['Vehicle']['kind'];
}) {
  const { timezone, distance_unit: unit } = useSettings();
  const id = useId();
  const year = Number(todayIn(timezone).slice(0, 4));
  const path = { id: vehicleId, year };
  const asked = useApiQuery('/vehicles/{id}/tax-years/{year}', { params: { path } });
  const row = asked.data ?? null;
  const change = useChange();
  const error = change.error ?? (asked.error ? 'The tax year could not be loaded.' : null);

  // The answer is the year's row: shown at once. The method changes the deduction, so the
  // totals are read again with every other figure.
  const choose = (method: Row['method']) =>
    change.run(
      (api) => api.PUT('/vehicles/{id}/tax-years/{year}', { params: { path }, body: { method } }),
      (next) => [put('/vehicles/{id}/tax-years/{year}', { path }, next)],
    );
  const why = notAutomobile(kind)
    ? 'No mileage rate applies to this type, so its expenses count either way.'
    : `Mileage rate: a set amount for each business ${unit === 'km' ? 'km' : 'mile'}. Actual expenses: what you spend running it.`;
  return (
    <div className="grid min-w-0 gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-title-small">{`${year} deduction`}</label>
        <Picker
          id={id}
          label={`${year} deduction for ${name}`}
          describedBy={`${id}-why`}
          size="sm"
          className="w-auto min-w-36"
          value={row?.method ?? 'standard_mileage'}
          onChange={(v) => void choose(v as Row['method'])}
          options={[
            { value: 'standard_mileage', label: 'Mileage rate' },
            { value: 'actual_expenses', label: 'Actual expenses' },
          ]}
        />
      </div>
      <p id={`${id}-why`} className="text-body-small text-muted-foreground">
        {why}
      </p>
      {error ? (
        <p role="alert" className="text-body-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
