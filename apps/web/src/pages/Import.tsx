import { useState } from 'react';
import { useApiQuery, useChange } from '../api/query';
import type { Schemas } from '../api/client';
import { formatDateTime, formatDistance, formatMoney } from '../format';
import { useSettings } from '../session';
import { SegmentedButtons } from '../ui/chips';
import { Button as UiButton } from '@/components/ui/button';
import { Button, Field, FormError, SelectField } from '../ui/form';
import { TableBox, tableClass } from '../ui/layout';

type Preview = Schemas['ImportPreview'];
type Result = Schemas['ImportResult'];
type Kind = 'expenses' | 'shifts' | 'mileiq';
type MileIqPreview = Schemas['MileIqPreview'];
type MileIqResult = Schemas['MileIqResult'];

/** A file's text. Blob.text() is missing in older browsers and in the test DOM. */
const readText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

/** Problem rows listed before "Show all problems". */
const FIRST = 10;

/** Settings card of the `import` module (18 section 12): preview first, then confirm; nothing is written by surprise. */
export function ImportCard() {
  const { modules } = useSettings();
  const [kind, setKind] = useState<Kind>(modules.expenses ? 'expenses' : 'shifts');
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [allProblems, setAllProblems] = useState(false);
  const change = useChange();
  const { error, setError } = change;

  /** The file goes as the raw CSV body, with the column mapping in the query. */
  const send = <T,>(
    path: '/imports/{kind}/preview' | '/imports/{kind}',
    map: Record<string, string | null>,
  ) =>
    change.run<T>(
      (api) =>
        api.POST(path, {
          params: { path: { kind }, query: { mapping: JSON.stringify(map) } },
          body: text as never,
          bodySerializer: (b: unknown) => b as never,
          headers: { 'Content-Type': 'text/csv' },
        } as never) as never,
    );

  async function pick(file: File | undefined) {
    setPreview(null);
    setResult(null);
    setError(null);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setError('A file can be 5 MB at most.');
    setFileName(file.name);
    setText(await readText(file));
  }
  async function run(map: Record<string, string | null>) {
    const p = await send<Preview>('/imports/{kind}/preview', map);
    if (!p) return;
    setPreview(p.data);
    setMapping(p.data.mapping);
    setAllProblems(false);
  }
  async function commit() {
    const r = await send<Result>('/imports/{kind}', mapping);
    if (!r) return;
    setResult(r.data);
    setPreview(null);
    setText(null);
  }

  // A preview lists at most 1000 problem rows; the count covers them all.
  const unlisted = preview ? (preview.summary.error ?? 0) - preview.problems.length : 0;
  const kinds = [
    ...(modules.expenses ? [{ value: 'expenses', label: 'Expenses' }] : []),
    { value: 'shifts', label: 'Shifts (distance typed, not tracked)' },
    { value: 'mileiq', label: 'Drives from MileIQ (its CSV report)' },
  ];
  const picker = (
    <SelectField
      label="What is in the file"
      value={kind}
      onChange={(v) => {
        setKind(v as Kind);
        setPreview(null);
        setResult(null);
        setText(null);
        setError(null);
      }}
      options={kinds}
    />
  );
  if (kind === 'mileiq')
    return (
      <section aria-label="Import" className="space-y-3">
        <h3 className="text-title-medium">Import a CSV file</h3>
        {picker}
        <MileIqImport />
      </section>
    );
  return (
    <section aria-label="Import" className="space-y-3">
      <h3 className="text-title-medium">Import a CSV file</h3>
      <FormError message={error} />
      {picker}
      <Field
        label="CSV file"
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      {text !== null && preview === null ? (
        <Button type="button" onClick={() => void run({})}>
          Preview {fileName}
        </Button>
      ) : null}
      {preview ? (
        <div className="space-y-3">
          <p>
            {preview.row_count} rows: {preview.summary.ok} ready, {preview.summary.duplicate}{' '}
            already there, {preview.summary.error} with problems.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {preview.fields.map((f) => (
              <SelectField
                key={f}
                label={`Column for ${f.replace(/_/g, ' ')}`}
                value={mapping[f] ?? ''}
                onChange={(v) => setMapping({ ...mapping, [f]: v === '' ? null : v })}
                options={[
                  { value: '', label: 'none' },
                  ...preview.columns.map((c) => ({ value: c, label: c })),
                ]}
              />
            ))}
          </div>
          <div className="flex gap-3">
            <UiButton type="button" variant="outline" onClick={() => void run(mapping)}>
              Check again
            </UiButton>
            <Button type="button" busy={preview.summary.ok === 0} onClick={() => void commit()}>
              Import {preview.summary.ok} rows
            </Button>
          </div>
          <ul id="import-problems" className="text-body-medium text-muted-foreground">
            {(allProblems ? preview.problems : preview.problems.slice(0, FIRST)).map((r) => (
              <li key={r.row}>
                Row {r.row}: {r.message}
              </li>
            ))}
          </ul>
          {preview.problems.length > FIRST ? (
            <UiButton
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-0"
              aria-expanded={allProblems}
              aria-controls="import-problems"
              onClick={() => setAllProblems(!allProblems)}
            >
              {allProblems ? 'Show fewer' : 'Show all problems'}
            </UiButton>
          ) : null}
          {unlisted > 0 && (allProblems || preview.problems.length <= FIRST) ? (
            <p className="text-body-medium text-muted-foreground">
              And {unlisted} more rows with problems, not listed. Fix these first, then check again.
            </p>
          ) : null}
        </div>
      ) : null}
      {result ? (
        <p role="status">
          Imported {result.imported} rows; {result.duplicates} were already there and{' '}
          {result.errors} had problems.
        </p>
      ) : null}
      <p className="text-body-small text-muted-foreground">
        Dates are YYYY-MM-DD and times HH:MM. Imported shifts are marked as imported in every
        export, because their distance was typed, not tracked.
      </p>
    </section>
  );
}

type Options = { unclassified: 'personal' | 'skip'; date_order?: 'mdy' | 'dmy' };
const CLASS: Record<string, string> = {
  business: 'Business',
  personal: 'Personal',
  other: 'Other category',
  unclassified: 'Unclassified',
};
const STATUS: Record<string, string> = {
  ok: 'Ready',
  duplicate: 'Already imported',
  error: 'Problem',
  skipped: 'Left out',
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The MileIQ preset (DECISIONS.md, 2026-11-10): a MileIQ drive report saved as CSV becomes one
 * imported shift per drive, business or personal. Preview first: what each class of drive becomes,
 * how dates and vehicles were read, the parking and tolls, the first drives and every problem.
 */
function MileIqImport() {
  const { distance_unit: unit, timezone, time_format: timeFormat, currency } = useSettings();
  const vehicles = useApiQuery('/vehicles').data ?? [];
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<MileIqPreview | null>(null);
  const [options, setOptions] = useState<Options>({ unclassified: 'personal' });
  const [result, setResult] = useState<MileIqResult | null>(null);
  const change = useChange();
  const { error, setError } = change;

  const send = <T,>(
    path: '/imports/mileiq/preview' | '/imports/mileiq',
    o: Options,
    body: string,
  ) =>
    change.run<T>(
      (api) =>
        api.POST(path, {
          params: { query: o },
          body: body as never,
          bodySerializer: (b: unknown) => b as never,
          headers: { 'Content-Type': 'text/csv' },
        } as never) as never,
    );

  async function pick(file: File | undefined) {
    setPreview(null);
    setResult(null);
    setError(null);
    setText(null);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setError('A file can be 5 MB at most.');
    setFileName(file.name);
    setText(await readText(file));
  }
  async function check(o: Options) {
    if (text === null) return;
    setOptions(o);
    const p = await send<MileIqPreview>('/imports/mileiq/preview', o, text);
    if (p) setPreview(p.data);
  }
  async function commit() {
    if (text === null) return;
    const r = await send<MileIqResult>('/imports/mileiq', options, text);
    if (!r) return;
    setResult(r.data);
    setPreview(null);
    setText(null);
  }

  const vehicleName = (id: number | null) => vehicles.find((v) => v.id === id)?.name ?? null;
  const p = preview;
  const personalCount = p ? p.classes.personal + p.classes.other : 0;
  return (
    <div className="space-y-3">
      <Field
        label="MileIQ report (CSV)"
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <FormError message={error} />
      {text !== null && p === null ? (
        <Button type="button" busy={change.busy} onClick={() => void check(options)}>
          Preview {fileName}
        </Button>
      ) : null}
      {p ? (
        <div className="space-y-4">
          <p>
            {plural(p.drive_count, 'drive')}: {p.summary.ok} ready, {p.summary.duplicate} already
            imported, {p.summary.error} with problems
            {p.summary.skipped ? `, ${p.summary.skipped} left out` : ''}.
          </p>
          <ul className="list-disc space-y-2 pl-5 text-body-medium">
            <li>
              Business: {plural(p.classes.business, 'drive')},{' '}
              {formatDistance(p.distance_m.business, unit)} to import. They count as business
              distance.
            </li>
            <li>
              Personal: {plural(personalCount, 'drive')}
              {p.classes.other
                ? ` (${p.classes.other} in MileIQ's medical, charity, moving or another category)`
                : ''}
              {p.unclassified === 'personal' && p.classes.unclassified
                ? `, and ${plural(p.classes.unclassified, 'unclassified drive')}`
                : ''}
              , {formatDistance(p.distance_m.personal, unit)} to import. Personal trips count in
              your total distance, never in your deduction.
            </li>
            <li>
              Dates read as {p.date_order === 'mdy' ? 'month/day/year' : 'day/month/year'}
              {p.date_order_source === 'file'
                ? ', as the dates in the file show.'
                : p.date_order_source === 'country'
                  ? ': every date fits both orders, so your country decided. Check the first drives below.'
                  : ', as you chose.'}{' '}
              Times are read in your time zone ({timezone}).
            </li>
            {p.unit !== unit ? (
              <li>
                The file is in {p.unit === 'mi' ? 'miles' : 'kilometres'}; MileWage converts it.
              </li>
            ) : null}
            {p.vehicles.map((v) => (
              <li key={v.name ?? ''}>
                {v.name ?? 'No vehicle in MileIQ'} ({plural(v.drives, 'drive')}):{' '}
                {v.vehicle_id === null
                  ? 'no vehicle of yours. Set a default vehicle in Settings, or add one named the same.'
                  : v.matched
                    ? `to your ${vehicleName(v.vehicle_id) ?? 'vehicle'}.`
                    : `to your ${vehicleName(v.vehicle_id) ?? 'default vehicle'}, your default vehicle.`}
              </li>
            ))}
            <li>
              {p.costs.expenses
                ? `Parking ${formatMoney(p.costs.parking_cents, currency)} and tolls ${formatMoney(p.costs.tolls_cents, currency)} become ${plural(p.costs.expenses, 'expense')} on their shifts.`
                : 'No parking or tolls to import.'}
              {p.costs.left_out
                ? ` Parking and tolls of ${plural(p.costs.left_out, 'drive')} are not imported: only business drives' costs are, and only while expenses are on.`
                : ''}
            </li>
            {p.value_ignored ? (
              <li>
                MileIQ&apos;s value column is not imported. MileWage works out your deduction from
                your mileage rate.
              </li>
            ) : null}
            <li>Start and end places are kept as text in each shift&apos;s notes.</li>
          </ul>
          <div className="flex flex-wrap gap-4">
            {p.classes.unclassified ? (
              <div className="space-y-1">
                <p className="text-body-small text-on-surface-variant">
                  {plural(p.classes.unclassified, 'unclassified drive')}
                </p>
                <SegmentedButtons
                  label="Unclassified drives"
                  value={options.unclassified}
                  onChange={(v) => void check({ ...options, unclassified: v })}
                  options={[
                    { value: 'personal', label: 'Import as personal' },
                    { value: 'skip', label: 'Leave out' },
                  ]}
                />
              </div>
            ) : null}
            <div className="space-y-1">
              <p className="text-body-small text-on-surface-variant">Order of dates</p>
              <SegmentedButtons
                label="Order of dates"
                value={p.date_order}
                onChange={(v) => void check({ ...options, date_order: v })}
                options={[
                  { value: 'mdy', label: 'Month first' },
                  { value: 'dmy', label: 'Day first' },
                ]}
              />
            </div>
          </div>
          {p.rows.length ? (
            <TableBox>
              <table className={tableClass}>
                <caption className="sr-only">First drives in the file</caption>
                <thead>
                  <tr>
                    <th scope="col">Line</th>
                    <th scope="col">Start</th>
                    <th scope="col">Category</th>
                    <th scope="col">Distance</th>
                    <th scope="col">Purpose</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((r) => (
                    <tr key={r.line}>
                      <td className="tabular-nums">{r.line}</td>
                      <td className="whitespace-nowrap tabular-nums">
                        {r.started_at === null
                          ? '—'
                          : formatDateTime(r.started_at, timezone, timeFormat)}
                      </td>
                      <td>{r.class ? CLASS[r.class] : '—'}</td>
                      <td className="whitespace-nowrap tabular-nums">
                        {formatDistance(r.distance_m, unit)}
                      </td>
                      <td>{r.purpose ?? ''}</td>
                      <td>{r.message ? `${STATUS[r.status]}: ${r.message}` : STATUS[r.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableBox>
          ) : null}
          {p.problems.length ? (
            <ul aria-label="Problems" className="text-body-medium text-muted-foreground">
              {p.problems.map((r) => (
                <li key={r.line}>
                  Line {r.line}: {r.message}
                </li>
              ))}
            </ul>
          ) : null}
          <Button
            type="button"
            busy={change.busy || p.summary.ok === 0}
            onClick={() => void commit()}
          >
            Import {plural(p.summary.ok, 'drive')}
          </Button>
        </div>
      ) : null}
      {result ? (
        <p role="status">
          Imported {plural(result.imported, 'drive')} as shifts; {result.duplicates} were already
          there, {result.errors} had problems and {result.skipped} were left out.
          {result.expenses ? ` Added ${plural(result.expenses, 'parking or toll expense')}.` : ''}
        </p>
      ) : null}
      <p className="text-body-small text-muted-foreground">
        In MileIQ, download your drive report as CSV, not PDF or Excel. Each drive becomes a shift
        marked as imported, because MileIQ recorded it, not this server.
      </p>
    </div>
  );
}
