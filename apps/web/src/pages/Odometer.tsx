import { useState } from 'react';
import { OdometerIcon, VehiclesIcon } from '@/ui/icons';
import { useQueries } from '@tanstack/react-query';
import { EmptyState, PageHeader, Section, TableBox, tableClass } from '../ui/layout';
import { Button as UiButton } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { unwrap } from '../api/client';
import { apiKey, errorText, useApiQuery, useChange } from '../api/query';
import type { Schemas } from '../api/client';
import { formatDateTime, formatDistance, parseDistance } from '../format';
import { useSession, useSettings } from '../session';
import { Button, DateField, Field, FormError, SelectField } from '../ui/form';
import { dayOf, startOfDay, todayIn } from '../days';

type Reading = Schemas['OdometerReading'];
type Kind = 'year_start' | 'year_end';

const KIND_TEXT: Record<Reading['kind'], string> = {
  year_start: 'Year start',
  year_end: 'Year end',
  shift_start: 'Shift start',
  shift_end: 'Shift end',
};

/**
 * Odometer logbook (07 section 2, 04 audit): tax-year start and end readings (what the tax
 * office asks comes from the `logbook` field of the settings, plan 21),
 * and the optional per-shift readings the phone or web entered. Readings are optional everywhere
 * and are shown in the driver's unit.
 */
export function OdometerPage() {
  const { api } = useSession();
  const { distance_unit: unit, timezone, logbook } = useSettings();
  const vehiclesQuery = useApiQuery('/vehicles');
  const vehicles = vehiclesQuery.data ?? null;
  const [chosen, setVehicleId] = useState('');
  // The first vehicle until the driver picks another.
  const vehicleId = chosen || (vehicles?.[0] ? String(vehicles[0].id) : '');
  const kinds = (['year_start', 'year_end', 'shift_start', 'shift_end'] as const).map((k) => {
    const params = { query: { vehicle_id: Number(vehicleId), kind: k } };
    return {
      queryKey: apiKey('/odometer', params),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        unwrap<Reading[]>(api.GET('/odometer', { params, signal })),
      enabled: !!vehicleId,
    };
  });
  const lists = useQueries({ queries: kinds });
  const readings = lists.every((q) => q.data)
    ? lists.flatMap((q) => q.data!).sort((x, y) => y.recorded_at - x.recorded_at)
    : null;
  const change = useChange();
  const { busy } = change;
  const error = errorText(change, vehiclesQuery, ...lists);
  const [kind, setKind] = useState<Kind>('year_start');
  const [date, setDate] = useState(() => todayIn(timezone));
  const [value, setValue] = useState('');

  async function add() {
    const metres = parseDistance(value, unit);
    if (metres === null) return change.setError(`Enter the odometer as a number of ${unit}.`);
    if (date > todayIn(timezone)) return change.setError('The date cannot be in the future.');
    const saved = await change.run((api) =>
      api.POST('/odometer', {
        body: {
          vehicle_id: Number(vehicleId),
          kind,
          reading_m: metres,
          recorded_at: startOfDay(date, timezone),
        },
      }),
    );
    if (saved) setValue('');
  }

  const remove = (r: Reading) =>
    change.run((api) => api.DELETE('/odometer/{id}', { params: { path: { id: r.id } } }));

  if (vehicles === null)
    return error ? <FormError message={error} /> : <p className="text-muted-foreground">Loading</p>;
  if (vehicles.length === 0)
    return (
      <section className="space-y-6">
        <PageHeader title="Odometer" />
        <EmptyState icon={VehiclesIcon}>
          There is no vehicle yet. Add one on the Vehicles screen first.
        </EmptyState>
      </section>
    );

  const year = todayIn(timezone).slice(0, 4);
  const yearReadings = (readings ?? []).filter((r) => r.kind.startsWith('year_'));
  const shiftReadings = (readings ?? []).filter((r) => r.kind.startsWith('shift_'));
  const missingStart =
    readings !== null &&
    !yearReadings.some(
      (r) => r.kind === 'year_start' && dayOf(r.recorded_at, timezone).startsWith(year),
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
          className="space-y-1 rounded-medium bg-surface-container-high px-4 py-3 text-body-medium text-on-surface"
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

      <Section title="Add a tax-year reading">
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
          <ReadingsTable title="Tax year" rows={yearReadings} onDelete={remove} />
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
  const { distance_unit: unit, timezone, time_format: tf } = useSettings();
  return (
    <Section label={title} title={<>{title}</>}>
      {rows.length === 0 ? (
        <EmptyState icon={OdometerIcon}>No readings.</EmptyState>
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
                  <td className="whitespace-nowrap tabular-nums">
                    {formatDateTime(r.recorded_at, timezone, tf)}
                  </td>
                  <td className="whitespace-nowrap text-muted-foreground">{KIND_TEXT[r.kind]}</td>
                  <td className="text-right whitespace-nowrap tabular-nums">
                    {formatDistance(r.reading_m, unit)}
                  </td>
                  <td className="text-right whitespace-nowrap">
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
                        className="ml-3 text-error"
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
