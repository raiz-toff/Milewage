import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Button as UiButton } from '@/components/ui/button';
import { PageHeader, Section } from '../ui/layout';
import { ApiError, describe, unwrap } from '../api/client';
import type { Modules, Schemas } from '../api/client';
import { useSession, useSettings } from '../session';
import { DateField, FormError, SelectField } from '../ui/form';
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
          <UiButton
            key={f}
            type="button"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void run(f)}
          >
            <Download />
            {`Download ${LABEL[f]}`}
          </UiButton>
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
      <PageHeader
        title="Exports"
        description="Files are produced from the stored shifts and trips. MileWage makes no claim that a file meets a tax office's record-keeping rules."
      />
      <Section title="Choose a period">
        <div className="grid gap-3 sm:grid-cols-4">
          <DateField label="From" value={from} onChange={setFrom} />
          <DateField label="To" value={to} onChange={setTo} />
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
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        ) : (
          <ExportButtons
            selection={{ from, to }}
            level={level}
            {...(vehicle ? { vehicleId: Number(vehicle) } : {})}
          />
        )}
      </Section>
      <Section title="Formats">
        <ul className="divide-y text-sm">
          {modules.exporters.map((f) => (
            <li
              key={f}
              className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:gap-4"
            >
              <span className="w-32 shrink-0 font-medium">{LABEL[f]}</span>
              <span className="text-muted-foreground">{HINT[f]}</span>
            </li>
          ))}
        </ul>
      </Section>
    </section>
  );
}
