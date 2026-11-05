import { useEffect, useState } from 'react';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { useSession, useSettings } from '../session';
import { Button, Field, FormError } from '../ui/form';
import { toMetres } from './Odometer';

type Reading = Schemas['OdometerReading'];
type Kind = 'shift_start' | 'shift_end';

const M_PER_MILE = 1609.344;
const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'shift_start', label: 'Start' },
  { kind: 'shift_end', label: 'End' },
];

const inUnit = (m: number, unit: 'km' | 'mi') =>
  String(Math.round((unit === 'km' ? m / 1000 : m / M_PER_MILE) * 10) / 10);

/** The optional start and end odometer readings of one shift (07 section 2), editable here. */
export function ShiftOdometer({ shift }: { shift: Schemas['Shift'] }) {
  const { api } = useSession();
  const { distance_unit: unit } = useSettings();
  const [values, setValues] = useState<Record<Kind, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Kind | null>(null);
  const locked = shift.status === 'finalized';

  useEffect(() => {
    let live = true;
    void Promise.all(
      KINDS.map(({ kind }) =>
        unwrap<Reading[]>(
          api.GET('/odometer', {
            params: {
              query: {
                vehicle_id: shift.vehicle_id,
                kind,
                from: shift.local_date,
                to: shift.local_date,
              },
            },
          }),
        ),
      ),
    )
      .then((lists) => {
        if (!live) return;
        const mine = (i: number) => lists[i]!.find((r) => r.shift_id === shift.id);
        const [a, b] = [mine(0), mine(1)];
        setValues({
          shift_start: a ? inUnit(a.reading_m, unit) : '',
          shift_end: b ? inUnit(b.reading_m, unit) : '',
        });
      })
      .catch((e) => live && setError(describe(e)));
    return () => {
      live = false;
    };
  }, [api, shift.id, shift.vehicle_id, shift.local_date, unit]);

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
    } catch (e) {
      setError(describe(e));
    }
  }

  if (values === null) return error ? <FormError message={error} /> : null;
  return (
    <section aria-label="Odometer" className="max-w-md space-y-2">
      <h2 className="font-heading text-lg">Odometer</h2>
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
              <span role="status" className="ml-2 text-sm text-accent">
                Saved.
              </span>
            ) : null}
          </div>
        ))}
      </div>
      {locked ? <p className="text-sm text-muted">A finalized shift cannot be changed.</p> : null}
      <FormError message={error} />
    </section>
  );
}
