import { useId, useState } from 'react';
import { notAutomobile } from '@milewage/shared';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { useApiQuery, useInvalidate, useSetApiData } from '../api/query';
import { useSession, useSettings } from '../session';
import { localDate } from './Dashboard';
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
  const { api } = useSession();
  const { timezone, distance_unit: unit } = useSettings();
  const id = useId();
  const year = Number(localDate(Date.now(), timezone).slice(0, 4));
  const path = { id: vehicleId, year };
  const asked = useApiQuery('/vehicles/{id}/tax-years/{year}', { params: { path } });
  const row = asked.data ?? null;
  const setData = useSetApiData();
  const invalidate = useInvalidate();
  const setRow = (next: Row) => {
    setData('/vehicles/{id}/tax-years/{year}', { path }, next);
    // The method changes the deduction, so the totals are read again.
    void invalidate('/summary', '/tax');
  };
  const [failed, setError] = useState<string | null>(null);
  const error = failed ?? (asked.error ? 'The tax year could not be loaded.' : null);

  async function choose(method: Row['method']) {
    setError(null);
    try {
      setRow(
        await unwrap<Row>(
          api.PUT('/vehicles/{id}/tax-years/{year}', { params: { path }, body: { method } }),
        ),
      );
    } catch (e) {
      setError(describe(e));
    }
  }
  const why = notAutomobile(kind)
    ? 'No mileage rate applies to this type, so its expenses count either way.'
    : `Mileage rate: a set amount for each business ${unit === 'km' ? 'km' : 'mile'}. Actual expenses: what you spend running it.`;
  return (
    <div className="grid min-w-0 gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-sm font-medium">{`${year} deduction`}</label>
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
      <p id={`${id}-why`} className="text-xs text-muted-foreground">
        {why}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
