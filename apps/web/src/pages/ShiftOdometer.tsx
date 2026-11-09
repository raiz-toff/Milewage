import { useState } from 'react';
import { Section } from '../ui/layout';
import type { Schemas } from '../api/client';
import { errorText, useChange } from '../api/query';
import { useSettings } from '../session';
import { Button, Field, FormError } from '../ui/form';
import { distanceInput, parseDistance } from '../format';
import type { ShiftReadings } from '../shift/record';
import type { Read } from '../shift/view';

type Kind = 'shift_start' | 'shift_end';

const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'shift_start', label: 'Start' },
  { kind: 'shift_end', label: 'End' },
];

/** The optional start and end odometer readings of one shift (07 section 2), editable here. */
export function ShiftOdometer({
  shift,
  readings,
  bare,
}: {
  shift: Schemas['Shift'];
  /** The shift's readings from the shift record. */
  readings: Read<ShiftReadings>;
  bare?: boolean;
}) {
  const { distance_unit: unit } = useSettings();
  const [edits, setValues] = useState<Record<Kind, string> | null>(null);
  const change = useChange();
  const [saved, setSaved] = useState<Kind | null>(null);
  const locked = shift.status === 'finalized';
  const held = readings.data;
  // What the driver typed, else what the server holds.
  const values: Record<Kind, string> | null =
    edits ??
    (held
      ? {
          shift_start: held.start ? distanceInput(held.start.reading_m, unit) : '',
          shift_end: held.end ? distanceInput(held.end.reading_m, unit) : '',
        }
      : null);
  const error = errorText(change, readings);

  async function save(kind: Kind) {
    const metres = parseDistance(values?.[kind] ?? '', unit);
    if (metres === null) return change.setError(`Enter the odometer as a number of ${unit}.`);
    setSaved(null);
    const done = await change.run((api) =>
      api.PUT('/shifts/{ref}/odometer/{kind}', {
        params: { path: { ref: String(shift.id), kind } },
        body: { reading_m: metres, recorded_at: Date.now() },
      }),
    );
    if (done) setSaved(kind);
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
