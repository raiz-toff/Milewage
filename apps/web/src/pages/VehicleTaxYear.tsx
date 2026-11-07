import { useEffect, useState } from 'react';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { useSession, useSettings } from '../session';
import { localDate } from './Dashboard';
import { Picker } from '../ui/form';

type Row = Schemas['VehicleTaxYear'];

/** How one vehicle is deducted this year (module `tax`, 18 section 7.1): mileage rate or actual expenses. */
export function VehicleTaxYear({ vehicleId, name }: { vehicleId: number; name: string }) {
  const { api } = useSession();
  const { timezone } = useSettings();
  const year = Number(localDate(Date.now(), timezone).slice(0, 4));
  const [row, setRow] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = { id: vehicleId, year };

  useEffect(() => {
    void unwrap<Row>(api.GET('/vehicles/{id}/tax-years/{year}', { params: { path } }))
      .then(setRow)
      .catch((e) => setError(describe(e)));
  }, [api, vehicleId, year]);

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
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span>{`Deduct ${name} in ${year} by`}</span>
      <Picker
        label={`Deduct ${name} in ${year} by`}
        size="sm"
        className="w-auto min-w-36"
        value={row?.method ?? 'standard_mileage'}
        onChange={(v) => void choose(v as Row['method'])}
        options={[
          { value: 'standard_mileage', label: 'Mileage rate' },
          { value: 'actual_expenses', label: 'Actual expenses' },
        ]}
      />
      {error ? <span role="alert"> {error}</span> : null}
    </div>
  );
}
