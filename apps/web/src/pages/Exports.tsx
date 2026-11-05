import { useEffect, useState } from 'react';
import { ApiError, describe, unwrap } from '../api/client';
import type { Modules, Schemas } from '../api/client';
import { useSession, useSettings } from '../session';
import { Button, Field, FormError, SelectField } from '../ui/form';
import { localDate } from './Dashboard';

type Format = Modules['exporters'][number];

const DAY = 86_400_000;
const LABEL: Record<Format, string> = {
  csv: 'CSV',
  pdf: 'PDF',
  gpx: 'GPX',
  geojson: 'GeoJSON',
  expenses: 'Expenses CSV',
  tax_summary: 'Tax summary',
};
const HINT: Record<Format, string> = {
  csv: 'Trips or shifts as a spreadsheet file.',
  pdf: 'A summary page and the trip log.',
  gpx: 'The recorded route. No payouts, labels or notes.',
  geojson: 'Routes and detected stops. No payouts, labels or notes.',
  expenses: 'Your expenses in the period for your accountant. No receipt files.',
  tax_summary:
    'The estimate of the period\u2019s year with its working: an estimate, not tax advice.',
};

/** Hands a downloaded file to the browser's save dialog. */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** The file name the server suggested, if it sent one. */
export function fileNameOf(disposition: string | null, fallback: string): string {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? '');
  return m?.[1] ? decodeURIComponent(m[1]) : fallback;
}

/** Days from `from` to `to` counting both ends; NaN when either is not a date. */
export const spanDays = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY + 1;

export type Selection = { from: string; to: string } | { shift_id: number };

/**
 * One button per registered exporter (`modules.exporters`). The file is fetched, so a refusal
 * (rate limit, a range over 366 days) is shown here and not as a raw error page.
 */
export function ExportButtons({
  selection,
  vehicleId,
  level,
}: {
  selection: Selection;
  vehicleId?: number;
  level?: 'trip' | 'shift';
}) {
  const { api } = useSession();
  const { modules } = useSettings();
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (modules.exporters.length === 0) return null;

  async function run(format: Format) {
    setBusy(format);
    setError(null);
    try {
      const query = {
        ...selection,
        ...(vehicleId ? { vehicle_id: vehicleId } : {}),
        ...(format === 'csv' && level ? { level } : {}),
      };
      const r = await api.GET('/exports/{format}', {
        params: { path: { format }, query },
        parseAs: 'blob',
      });
      if (!r.response.ok) {
        throw ApiError.from(r.response, r.error);
      }
      const stem =
        'from' in selection ? `${selection.from}_${selection.to}` : `shift-${selection.shift_id}`;
      saveBlob(
        r.data as Blob,
        fileNameOf(r.response.headers.get('Content-Disposition'), `milewage-${stem}.${format}`),
      );
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3">
        {modules.exporters.map((f) => (
          <Button key={f} type="button" busy={busy !== null} onClick={() => void run(f)}>
            {`Download ${LABEL[f]}`}
          </Button>
        ))}
      </div>
      <FormError message={error} />
    </div>
  );
}

/** Exports screen (module `exporters`): choose a period, optionally a vehicle, then a format. */
export function ExportsPage() {
  const { api } = useSession();
  const { timezone, modules } = useSettings();
  const [from, setFrom] = useState(() => localDate(Date.now() - 29 * DAY, timezone));
  const [to, setTo] = useState(() => localDate(Date.now(), timezone));
  const [vehicles, setVehicles] = useState<Schemas['Vehicle'][]>([]);
  const [vehicle, setVehicle] = useState('');
  const [level, setLevel] = useState<'trip' | 'shift'>('trip');

  useEffect(() => {
    void unwrap(api.GET('/vehicles', { params: { query: {} } }))
      .then(setVehicles)
      .catch(() => setVehicles([]));
  }, [api]);

  const days = spanDays(from, to);
  const problem = Number.isNaN(days)
    ? 'Choose both dates.'
    : days < 1
      ? 'The start date must not be after the end date.'
      : days > 366
        ? 'A period can be at most 366 days.'
        : null;

  return (
    <section className="space-y-6">
      <h1 className="font-heading text-2xl">Exports</h1>
      <div className="grid max-w-3xl gap-3 sm:grid-cols-4">
        <Field label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Field label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        {vehicles.length > 1 ? (
          <SelectField
            label="Vehicle"
            value={vehicle}
            onChange={setVehicle}
            options={[
              { value: '', label: 'All vehicles' },
              ...vehicles.map((v) => ({ value: String(v.id), label: v.name })),
            ]}
          />
        ) : null}
        {modules.exporters.includes('csv') ? (
          <SelectField
            label="CSV rows"
            value={level}
            onChange={(v) => setLevel(v as 'trip' | 'shift')}
            options={[
              { value: 'trip', label: 'One row per trip' },
              { value: 'shift', label: 'One row per shift' },
            ]}
          />
        ) : null}
      </div>
      {problem ? (
        <p role="alert" className="text-muted">
          {problem}
        </p>
      ) : (
        <ExportButtons
          selection={{ from, to }}
          level={level}
          {...(vehicle ? { vehicleId: Number(vehicle) } : {})}
        />
      )}
      <ul className="space-y-1 text-sm text-muted">
        {modules.exporters.map((f) => (
          <li key={f}>
            <span className="text-ink">{LABEL[f]}</span>: {HINT[f]}
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">
        Files are produced from the stored shifts and trips. MileWage makes no claim that a file
        meets a tax office&apos;s record-keeping rules.
      </p>
    </section>
  );
}
