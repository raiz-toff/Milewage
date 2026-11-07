import { useCallback, useEffect, useState } from 'react';
import { EmptyState, PageHeader, Section, TableBox, tableClass } from '../ui/layout';
import { Button as UiButton } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { formatDateTime, formatDistance } from '../format';
import { useSession, useSettings } from '../session';
import { Button, DateField, Field, FormError, SelectField } from '../ui/form';
import { localDate } from './Dashboard';

type Reading = Schemas['OdometerReading'];
type Vehicle = Schemas['Vehicle'];
type Kind = 'year_start' | 'year_end';

const M_PER_MILE = 1609.344;

/** A typed odometer value in the driver's unit to whole metres; null when it is not a number. */
export function toMetres(text: string, unit: 'km' | 'mi'): number | null {
  const t = text.trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(Number(t) * (unit === 'km' ? 1000 : M_PER_MILE));
}

/** The instant a local calendar date begins in a time zone (the date reads back the same). */
export function startOfLocalDay(date: string, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  let guess = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 3; i++) {
    const shown = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(new Date(guess))
      .reduce<Record<string, number>>((a, p) => ({ ...a, [p.type]: Number(p.value) }), {});
    const asUtc = Date.UTC(shown.year!, shown.month! - 1, shown.day!, shown.hour, shown.minute);
    guess -= asUtc - Date.UTC(y, m - 1, d);
  }
  return guess;
}

const KIND_TEXT: Record<Reading['kind'], string> = {
  year_start: 'Year start',
  year_end: 'Year end',
  shift_start: 'Shift start',
  shift_end: 'Shift end',
};

/**
 * Odometer logbook (07 section 2, 04 audit): fiscal-year start and end readings (what the tax
 * office asks comes from the `logbook` field of the settings, plan 21),
 * and the optional per-shift readings the phone or web entered. Readings are optional everywhere
 * and are shown in the driver's unit.
 */
export function OdometerPage() {
  const { api } = useSession();
  const { distance_unit: unit, timezone, logbook } = useSettings();
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [vehicleId, setVehicleId] = useState('');
  const [readings, setReadings] = useState<Reading[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>('year_start');
  const [date, setDate] = useState(() => localDate(Date.now(), timezone));
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void unwrap(api.GET('/vehicles', { params: { query: {} } }))
      .then((v) => {
        setVehicles(v);
        setVehicleId(v[0] ? String(v[0].id) : '');
      })
      .catch((e) => setError(describe(e)));
  }, [api]);

  const load = useCallback(async () => {
    if (!vehicleId) return;
    try {
      const query = { vehicle_id: Number(vehicleId) };
      const lists: Reading[][] = await Promise.all(
        (['year_start', 'year_end', 'shift_start', 'shift_end'] as const).map((k) =>
          unwrap<Reading[]>(api.GET('/odometer', { params: { query: { ...query, kind: k } } })),
        ),
      );
      setReadings(lists.flat().sort((x, y) => y.recorded_at - x.recorded_at));
    } catch (e) {
      setError(describe(e));
    }
  }, [api, vehicleId]);
  useEffect(() => {
    setReadings(null);
    void load();
  }, [load]);

  async function add() {
    const metres = toMetres(value, unit);
    if (metres === null) return setError(`Enter the odometer as a number of ${unit}.`);
    if (date > localDate(Date.now(), timezone))
      return setError('The date cannot be in the future.');
    setBusy(true);
    setError(null);
    try {
      await unwrap(
        api.POST('/odometer', {
          body: {
            vehicle_id: Number(vehicleId),
            kind,
            reading_m: metres,
            recorded_at: startOfLocalDay(date, timezone),
          },
        }),
      );
      setValue('');
      await load();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: Reading) {
    setError(null);
    try {
      await unwrap(api.DELETE('/odometer/{id}', { params: { path: { id: r.id } } }));
      await load();
    } catch (e) {
      setError(describe(e));
    }
  }

  if (vehicles === null)
    return error ? <FormError message={error} /> : <p className="text-muted-foreground">Loading</p>;
  if (vehicles.length === 0)
    return (
      <section className="space-y-6">
        <PageHeader title="Odometer" />
        <EmptyState>There is no vehicle yet. Add one on the Vehicles screen first.</EmptyState>
      </section>
    );

  const year = localDate(Date.now(), timezone).slice(0, 4);
  const yearReadings = (readings ?? []).filter((r) => r.kind.startsWith('year_'));
  const shiftReadings = (readings ?? []).filter((r) => r.kind.startsWith('shift_'));
  const missingStart =
    readings !== null &&
    !yearReadings.some(
      (r) => r.kind === 'year_start' && localDate(r.recorded_at, timezone).startsWith(year),
    );

  return (
    <section className="space-y-6">
      <PageHeader
        title="Odometer"
        description={
          logbook ? undefined : 'Readings are optional. Enter them if your tax office asks.'
        }
      >
        {vehicles.length > 1 ? (
          <SelectField
            label="Vehicle"
            value={vehicleId}
            onChange={setVehicleId}
            options={vehicles.map((v) => ({ value: String(v.id), label: v.name }))}
          />
        ) : null}
      </PageHeader>

      {logbook ? (
        <div
          role="note"
          className="space-y-1 rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm"
        >
          <p>
            {logbook.readings}
            {missingStart ? ` There is no year-start reading for ${year} yet.` : ''}
          </p>
          {logbook.notes.map((n) => (
            <p key={n} className="text-muted-foreground">
              {n}
            </p>
          ))}
        </div>
      ) : null}

      <Section title="Add a fiscal-year reading">
        <form
          className="grid gap-3 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <SelectField
            label="Reading"
            value={kind}
            onChange={(v) => setKind(v as Kind)}
            options={[
              { value: 'year_start', label: 'Year start' },
              { value: 'year_end', label: 'Year end' },
            ]}
          />
          <DateField label="Date" value={date} onChange={setDate} />
          <Field
            label={`Odometer (${unit})`}
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="flex items-end">
            <Button type="submit" busy={busy || value.trim() === ''}>
              Add reading
            </Button>
          </div>
        </form>
        <FormError message={error} />
      </Section>

      {readings === null ? (
        <p className="text-muted-foreground">Loading</p>
      ) : (
        <>
          <ReadingsTable title="Fiscal year" rows={yearReadings} onDelete={remove} />
          <ReadingsTable title="Shifts" rows={shiftReadings} />
        </>
      )}
    </section>
  );
}

function ReadingsTable({
  title,
  rows,
  onDelete,
}: {
  title: string;
  rows: Reading[];
  onDelete?: (r: Reading) => void;
}) {
  const { distance_unit: unit, timezone } = useSettings();
  return (
    <Section label={title} title={<>{title}</>}>
      {rows.length === 0 ? (
        <EmptyState>No readings.</EmptyState>
      ) : (
        <TableBox>
          <table className={tableClass}>
            <caption className="sr-only">{title} readings</caption>
            <thead>
              <tr>
                <th>When</th>
                <th>Kind</th>
                <th className="text-right">Reading</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-2 pr-4 tabular-nums text-sm">
                    {formatDateTime(r.recorded_at, timezone)}
                  </td>
                  <td className="pr-4 text-muted-foreground">{KIND_TEXT[r.kind]}</td>
                  <td className="pr-4 text-right tabular-nums">
                    {formatDistance(r.reading_m, unit)}
                  </td>
                  <td className="text-right">
                    {r.shift_id !== null ? (
                      <Link
                        className="font-medium underline decoration-primary decoration-2 underline-offset-4"
                        to={`/shifts/${r.shift_id}`}
                      >
                        Shift
                      </Link>
                    ) : null}
                    {onDelete ? (
                      <UiButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="ml-3"
                        onClick={() => onDelete(r)}
                      >
                        Delete
                      </UiButton>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableBox>
      )}
    </Section>
  );
}
