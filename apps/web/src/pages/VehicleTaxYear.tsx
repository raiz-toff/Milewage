import { useEffect, useState } from 'react';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { useSession, useSettings } from '../session';
import { localDate } from './Dashboard';

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
    <label className="block text-sm text-muted">
      {`Deduct ${name} in ${year} by`}{' '}
      <select
        className="rounded border border-line bg-bg px-2 py-1 text-ink"
        value={row?.method ?? 'standard_mileage'}
        onChange={(e) => void choose(e.target.value as Row['method'])}
      >
        <option value="standard_mileage">Mileage rate</option>
        <option value="actual_expenses">Actual expenses</option>
      </select>
      {error ? <span role="alert"> {error}</span> : null}
    </label>
  );
}
