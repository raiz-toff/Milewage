import { useState } from 'react';
import { Section } from '../ui/layout';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { useApiQuery, useInvalidate } from '../api/query';
import { useSession, useSettings } from '../session';
import { Button, Field, FormError } from '../ui/form';
import { localDate } from './Dashboard';
import { toMetres } from './Odometer';

type Kind = 'shift_start' | 'shift_end';

const M_PER_MILE = 1609.344;
const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'shift_start', label: 'Start' },
  { kind: 'shift_end', label: 'End' },
];

const inUnit = (m: number, unit: 'km' | 'mi') =>
  String(Math.round((unit === 'km' ? m / 1000 : m / M_PER_MILE) * 10) / 10);

/** The optional start and end odometer readings of one shift (07 section 2), editable here. */
export function ShiftOdometer({ shift, bare }: { shift: Schemas['Shift']; bare?: boolean }) {
  const { api } = useSession();
  const { distance_unit: unit, timezone } = useSettings();
  // A shift that runs past midnight can have its end reading on the next local day.
  const lastDay = shift.ended_at ? localDate(shift.ended_at, timezone) : shift.local_date;
  const [edits, setValues] = useState<Record<Kind, string> | null>(null);
  const [failed, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Kind | null>(null);
  const invalidate = useInvalidate();
  const locked = shift.status === 'finalized';
  const readings = (kind: Kind) => ({
    params: {
      query: {
        vehicle_id: shift.vehicle_id,
        kind,
        from: shift.local_date,
        to: lastDay > shift.local_date ? lastDay : shift.local_date,
      },
    },
  });
  const starts = useApiQuery('/odometer', readings('shift_start'));
  const ends = useApiQuery('/odometer', readings('shift_end'));
  const mine = (list: Schemas['OdometerReading'][]) => list.find((r) => r.shift_id === shift.id);
  const [a, b] = [starts.data && mine(starts.data), ends.data && mine(ends.data)];
  // What the driver typed, else what the server holds.
  const values: Record<Kind, string> | null =
    edits ??
    (starts.data && ends.data
      ? {
          shift_start: a ? inUnit(a.reading_m, unit) : '',
          shift_end: b ? inUnit(b.reading_m, unit) : '',
        }
      : null);
  const loadError = starts.error ?? ends.error;
  const error = failed ?? (loadError ? describe(loadError) : null);

  async function save(kind: Kind) {
    const metres = toMetres(values?.[kind] ?? '', unit);
    if (metres === null) return setError(`Enter the odometer as a number of ${unit}.`);
    setError(null);
    setSaved(null);
    try {
      await unwrap(
        api.PUT('/shifts/{ref}/odometer/{kind}', {
          params: { path: { ref: String(shift.id), kind } },
          body: { reading_m: metres, recorded_at: Date.now() },
        }),
      );
      setSaved(kind);
      void invalidate('/odometer');
    } catch (e) {
      setError(describe(e));
    }
  }

  if (values === null) return error ? <FormError message={error} /> : null;
  return (
    <Section label="Odometer" title="Odometer" bare={bare}>
      <div className="grid grid-cols-2 gap-4">
        {KINDS.map(({ kind, label }) => (
          <div key={kind} className="space-y-2">
            <Field
              label={`${label} (${unit})`}
              inputMode="decimal"
              disabled={locked}
              value={values[kind]}
              onChange={(e) => {
                setSaved(null);
                setValues({ ...values, [kind]: e.target.value });
              }}
            />
            <Button
              type="button"
              busy={locked || values[kind].trim() === ''}
              onClick={() => void save(kind)}
              aria-label={`Save ${label.toLowerCase()} reading`}
            >
              Save
            </Button>
            {saved === kind ? (
              <span role="status" className="ml-2 text-sm font-medium">
                Saved.
              </span>
            ) : null}
          </div>
        ))}
      </div>
      {locked ? (
        <p className="text-sm text-muted-foreground">A finalized shift cannot be changed.</p>
      ) : null}
      <FormError message={error} />
    </Section>
  );
}
