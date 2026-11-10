import { useId, useState } from 'react';
import { DownloadIcon } from '@/ui/icons';
import { Button as UiButton } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { PageHeader, Section } from '../ui/layout';
import { ApiError, describe } from '../api/client';
import { useApiQuery } from '../api/query';
import type { Modules } from '../api/client';
import { HelpLink } from '../help';
import { useSession, useSettings } from '../session';
import { DateField, FormError, Picker, SelectField } from '../ui/form';
import { PERIODS, dateLocale, formatDay, period, todayIn } from '../days';
import type { Range } from '../days';

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
 * Fetches one export and saves it, so a refusal (rate limit, a range over 366 days) is shown on
 * the page and not as a raw error page. `error.format` is the file that was refused.
 */
function useExport(selection: Selection, vehicleId?: number, level?: 'trip' | 'shift') {
  const { api } = useSession();
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState<{ format: Format; message: string } | null>(null);

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
      setError({ format, message: describe(e) });
    } finally {
      setBusy(null);
    }
  }

  return { busy, error, run };
}

/** One button per registered exporter (`modules.exporters`), on a shift's detail page. */
export function ExportButtons({ selection }: { selection: Selection }) {
  const { modules } = useSettings();
  const { busy, error, run } = useExport(selection);

  if (modules.exporters.length === 0) return null;

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
            <DownloadIcon />
            {`Download ${LABEL[f]}`}
          </UiButton>
        ))}
      </div>
      <FormError message={error?.message ?? null} />
    </div>
  );
}

/** On the Exports screen a file is named by what it is for; the format is in its line. */
const NAME: Record<Format, string> = {
  csv: 'Mileage log',
  pdf: 'Mileage report',
  expenses: 'Expenses',
  tax_summary: 'Tax summary',
  gpx: 'GPX',
  geojson: 'GeoJSON',
};
const HINT: Record<Format, string> = {
  csv: 'Your trips or shifts in the period, as a spreadsheet (CSV).',
  pdf: 'A summary page and the trip log (PDF).',
  expenses: 'Your expenses in the period, as a spreadsheet (CSV). No receipt files.',
  tax_summary: 'The estimate for {year} with its working (CSV): an estimate, not tax advice.',
  gpx: 'The recorded routes, for map and GPS apps. No money, labels or notes.',
  geojson: 'Routes and detected stops, for mapping tools. No money, labels or notes.',
};
const GROUPS: { title: string; description?: string; formats: Format[] }[] = [
  {
    title: 'For your accountant',
    description: 'MileWage makes no claim that a file meets a tax office’s record-keeping rules.',
    formats: ['csv', 'expenses', 'tax_summary', 'pdf'],
  },
  { title: 'Routes for map apps', formats: ['gpx', 'geojson'] },
];

/** Ready-made periods, each within the 366-day limit; "Custom" shows the two date pickers. */
const soFar = (id: string) => PERIODS.find((p) => p.id === id)!.range;
const PRESETS: {
  id: string;
  label: string;
  range?: (today: string, weekStart: number) => Range;
}[] = [
  { id: 'month', label: 'This month', range: soFar('month') },
  { id: 'last-month', label: 'Last month', range: (t, ws) => period('month', t, ws, -1) },
  { id: 'year', label: 'This year', range: soFar('year') },
  { id: 'last-year', label: 'Last year', range: (t, ws) => period('year', t, ws, -1) },
  { id: 'custom', label: 'Custom' },
];

/**
 * Exports screen (module `exporters`): a period (presets; the date pickers only for "Custom"),
 * then each file under what it is for, with its own Download button.
 */
export function ExportsPage() {
  const { timezone, country, modules, week_start: weekStart } = useSettings();
  const today = todayIn(timezone);
  const [preset, setPreset] = useState('year');
  const [custom, setCustom] = useState<[string, string]>([today, today]);
  // The vehicle filter is offered only when the list could be read.
  const vehicles = useApiQuery('/vehicles').data ?? [];
  const [vehicle, setVehicle] = useState('');
  const [level, setLevel] = useState<'trip' | 'shift'>('trip');
  const periodId = useId();

  const chosen = PRESETS.find((p) => p.id === preset)?.range?.(today, weekStart);
  const [from, to] = chosen ? [chosen.from, chosen.to] : custom;
  const { busy, error, run } = useExport(
    { from, to },
    vehicle ? Number(vehicle) : undefined,
    level,
  );

  function choose(id: string) {
    // Custom starts from the period on screen, so the pickers usually need a small change only.
    if (id === 'custom') setCustom([from, to]);
    setPreset(id);
  }

  const days = spanDays(from, to);
  const problem = Number.isNaN(days)
    ? 'Choose both dates.'
    : days < 1
      ? 'The start date must not be after the end date.'
      : days > 366
        ? 'A period can be at most 366 days.'
        : null;
  const locale = dateLocale(country);

  const row = (f: Format) => (
    <li
      key={f}
      className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 space-y-1">
        <p className="font-medium">{NAME[f]}</p>
        <p className="text-sm text-muted-foreground">
          {HINT[f].replace('{year}', from.slice(0, 4))}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {f === 'csv' ? (
          <Picker
            label="CSV rows"
            size="sm"
            className="w-auto"
            value={level}
            onChange={(v) => setLevel(v as 'trip' | 'shift')}
            options={[
              { value: 'trip', label: 'One row per trip' },
              { value: 'shift', label: 'One row per shift' },
            ]}
          />
        ) : null}
        <UiButton
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Download ${NAME[f]}`}
          disabled={busy !== null || problem !== null}
          onClick={() => void run(f)}
        >
          <DownloadIcon />
          Download
        </UiButton>
      </div>
    </li>
  );

  return (
    <section className="space-y-6">
      <PageHeader
        title="Exports"
        description={
          <>
            Files made from your shifts, trips and expenses.{' '}
            <HelpLink page="for-your-accountant">What to give your accountant</HelpLink>
          </>
        }
      />
      <Section title={<span id={periodId}>Period</span>}>
        <div className="space-y-2">
          <RadioGroup
            aria-labelledby={periodId}
            value={preset}
            onValueChange={choose}
            className="flex flex-wrap gap-x-5 gap-y-3"
          >
            {PRESETS.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <RadioGroupItem value={p.id} />
                {p.label}
              </label>
            ))}
          </RadioGroup>
          {preset !== 'custom' ? (
            <p className="text-sm text-muted-foreground tabular-nums">
              {`${formatDay(from, locale)} – ${formatDay(to, locale)}`}
            </p>
          ) : null}
        </div>
        {preset === 'custom' || vehicles.length > 1 ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {preset === 'custom' ? (
              <>
                <DateField label="From" value={from} onChange={(v) => setCustom([v, to])} />
                <DateField label="To" value={to} onChange={(v) => setCustom([from, v])} />
              </>
            ) : null}
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
          </div>
        ) : null}
        {problem ? (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        ) : null}
      </Section>
      {GROUPS.map((g) => {
        const formats = g.formats.filter((f) => modules.exporters.includes(f));
        return formats.length === 0 ? null : (
          <Section key={g.title} title={g.title} description={g.description} label={g.title}>
            <ul className="divide-y">{formats.map(row)}</ul>
            <FormError message={error && formats.includes(error.format) ? error.message : null} />
          </Section>
        );
      })}
    </section>
  );
}
