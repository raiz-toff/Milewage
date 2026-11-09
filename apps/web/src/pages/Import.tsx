import { useState } from 'react';
import { useChange } from '../api/query';
import type { Schemas } from '../api/client';
import { useSettings } from '../session';
import { Button as UiButton } from '@/components/ui/button';
import { Button, Field, FormError, SelectField } from '../ui/form';

type Preview = Schemas['ImportPreview'];
type Result = Schemas['ImportResult'];
type Kind = 'expenses' | 'shifts';

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
    setText(
      await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); // Blob.text() is missing in older browsers and in the test DOM
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      }),
    );
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
  ];
  return (
    <section aria-label="Import" className="space-y-3">
      <h3 className="text-base leading-snug font-medium">Import a CSV file</h3>
      <FormError message={error} />
      <SelectField
        label="What is in the file"
        value={kind}
        onChange={(v) => {
          setKind(v as Kind);
          setPreview(null);
          setResult(null);
        }}
        options={kinds}
      />
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
          <ul id="import-problems" className="text-sm text-muted-foreground">
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
            <p className="text-sm text-muted-foreground">
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
      <p className="text-xs text-muted-foreground">
        Dates are YYYY-MM-DD and times HH:MM. Imported shifts are marked as imported in every
        export, because their distance was typed, not tracked.
      </p>
    </section>
  );
}
