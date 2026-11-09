import { useState } from 'react';
import type { FormEvent } from 'react';
import { put, useChange } from '../api/query';
import type { Schemas } from '../api/client';
import { useSettings } from '../session';
import { Button, Field, FormError, SelectField } from '../ui/form';
import { startOfDay } from '../days';
import { parseDistance } from '../format';
import { Button as UiButton } from '@/components/ui/button';

type Shift = Schemas['Shift'];

const MIN = 60_000;

/** "HH:MM" (24 h) of an instant in the driver's time zone, for a time input. */
const hhmm = (ms: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(ms);

/** A random (v4) UUID. `crypto.randomUUID` needs HTTPS; a server on a home network may not have it. */
export function uuid(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A time typed for the shift's day, as an instant; a time before `after` is the next day. */
function atTime(text: string, shift: Shift, timeZone: string, after = 0): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const at = startOfDay(shift.local_date, timeZone) + Number(m[1]) * 60 * MIN + Number(m[2]) * MIN;
  return at < after ? at + 24 * 60 * MIN : at;
}

/**
 * A trip the phone did not record, typed in by hand (`PUT /shifts/{ref}/trips/{client_id}`,
 * source manual). It counts in the totals and is marked "edited" in the timeline.
 */
export function AddTrip({
  shift,
  onClose,
}: {
  shift: Shift;
  /** Closes the form: after a save, or on Cancel. */
  onClose: () => void;
}) {
  const { distance_unit: unit, timezone } = useSettings();
  const from = hhmm(shift.started_at, timezone);
  const to = hhmm(shift.ended_at ?? shift.started_at, timezone);
  const [form, setForm] = useState({ from, to, distance: '', kind: 'active', purpose: '' });
  const change = useChange();
  const { error, setError } = change;
  const set = (k: keyof typeof form) => (v: string) => setForm({ ...form, [k]: v });

  async function save(e: FormEvent) {
    e.preventDefault();
    const distance = parseDistance(form.distance, unit);
    if (!distance) return setError(`Enter the distance as a number of ${unit} above zero.`);
    // Times left as they were are the shift's own, to the millisecond.
    const started = form.from === from ? shift.started_at : atTime(form.from, shift, timezone);
    const ended =
      started === null
        ? null
        : form.to === to && shift.ended_at
          ? shift.ended_at
          : atTime(form.to, shift, timezone, started);
    if (started === null || ended === null)
      return setError('Enter the times as hours and minutes.');
    const ref = String(shift.id);
    const saved = await change.run(
      (api) =>
        api.PUT('/shifts/{ref}/trips/{client_id}', {
          params: { path: { ref, client_id: uuid() } },
          body: {
            kind: form.kind as Schemas['TripKind'],
            started_at: started,
            ended_at: ended,
            distance_m: distance,
            purpose: form.purpose.trim(),
            edited_at: Date.now(),
          },
        }),
      // The answer carries the recomputed shift; its trips are read again.
      (r) => [put('/shifts/{ref}', { path: { ref } }, r.shift)],
    );
    if (saved) onClose();
  }

  return (
    <form
      aria-label="Add a trip"
      className="grid grid-cols-2 gap-3 rounded-lg border p-3"
      onSubmit={(e) => void save(e)}
    >
      <p className="col-span-2 text-sm text-muted-foreground">
        A trip the phone did not record. It counts in your totals and shows as edited.
      </p>
      <Field
        label="From"
        type="time"
        value={form.from}
        onChange={(e) => set('from')(e.target.value)}
      />
      <Field label="To" type="time" value={form.to} onChange={(e) => set('to')(e.target.value)} />
      <Field
        label={`Distance (${unit})`}
        inputMode="decimal"
        autoFocus
        value={form.distance}
        onChange={(e) => set('distance')(e.target.value)}
      />
      <SelectField
        label="Kind"
        value={form.kind}
        onChange={set('kind')}
        options={[
          { value: 'active', label: 'Business' },
          { value: 'personal', label: 'Personal' },
        ]}
      />
      <div className="col-span-2">
        <Field
          label="Purpose"
          maxLength={200}
          value={form.purpose}
          onChange={(e) => set('purpose')(e.target.value)}
        />
      </div>
      <div className="col-span-2 flex items-center gap-2">
        <Button type="submit" busy={form.distance.trim() === '' || form.purpose.trim() === ''}>
          Add trip
        </Button>
        <UiButton type="button" variant="ghost" onClick={onClose}>
          Cancel
        </UiButton>
      </div>
      <div className="col-span-2">
        <FormError message={error} />
      </div>
    </form>
  );
}
