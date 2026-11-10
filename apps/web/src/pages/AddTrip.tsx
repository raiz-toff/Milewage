import { useState } from 'react';
import type { FormEvent } from 'react';
import { put, useChange } from '../api/query';
import type { Schemas } from '../api/client';
import { useSettings } from '../session';
import { Button, Field, FormError, SelectField } from '../ui/form';
import { startOfDay } from '../days';
import { distanceInput, formatDistance, formatTime, parseDistance } from '../format';
import { Button as UiButton } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Shift = Schemas['Shift'];
type Trip = Schemas['Trip'];

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
 * source manual). It counts in the totals and is marked "edited" in the timeline. Given `trip` (a
 * manual trip), the same form edits it (TODO W2i): the same PUT on the trip's own id, newer than
 * its last edit, so the change reaches the phone through the change feed like any other.
 */
export function AddTrip({
  shift,
  trip,
  onClose,
}: {
  shift: Shift;
  /** The manual trip to edit; absent to add one. */
  trip?: Trip;
  /** Closes the form: after a save, or on Cancel. */
  onClose: () => void;
}) {
  const { distance_unit: unit, timezone } = useSettings();
  const from = hhmm(trip?.started_at ?? shift.started_at, timezone);
  const to = hhmm(trip?.ended_at ?? shift.ended_at ?? shift.started_at, timezone);
  const distance = trip ? distanceInput(trip.distance_m, unit, 2) : '';
  const [form, setForm] = useState({
    from,
    to,
    distance,
    kind: trip?.kind ?? 'active',
    purpose: trip?.purpose ?? '',
  });
  const change = useChange();
  const { error, setError } = change;
  const set = (k: keyof typeof form) => (v: string) => setForm({ ...form, [k]: v });
  // Times and a distance left as they were keep their exact stored values.
  const ownStart = trip?.started_at ?? shift.started_at;
  const ownEnd = trip ? trip.ended_at : shift.ended_at;

  async function save(e: FormEvent) {
    e.preventDefault();
    const metres =
      trip && form.distance === distance ? trip.distance_m : parseDistance(form.distance, unit);
    if (!metres) return setError(`Enter the distance as a number of ${unit} above zero.`);
    const started = form.from === from ? ownStart : atTime(form.from, shift, timezone);
    const ended =
      started === null
        ? null
        : form.to === to && ownEnd
          ? ownEnd
          : atTime(form.to, shift, timezone, started);
    if (started === null || ended === null)
      return setError('Enter the times as hours and minutes.');
    if (ended < started) return setError('The trip must end after it starts.');
    const ref = String(shift.id);
    const saved = await change.run(
      (api) =>
        api.PUT('/shifts/{ref}/trips/{client_id}', {
          params: { path: { ref, client_id: trip?.trip_key ?? uuid() } },
          body: {
            kind: form.kind as Schemas['TripKind'],
            started_at: started,
            ended_at: ended,
            distance_m: metres,
            purpose: form.purpose.trim(),
            // Newer than the trip's last edit (the phone's clock may be ahead), so it applies.
            edited_at: Math.max(Date.now(), (trip?.edited_at ?? 0) + 1),
          },
        }),
      // The answer carries the recomputed shift; its trips are read again.
      (r) => [put('/shifts/{ref}', { path: { ref } }, r.shift)],
    );
    if (saved) onClose();
  }

  const kinds = [
    { value: 'active', label: 'Business' },
    ...(trip?.kind === 'deadhead' ? [{ value: 'deadhead', label: 'Deadhead' }] : []),
    { value: 'personal', label: 'Personal' },
  ];
  const name = trip ? 'Edit trip' : 'Add a trip';
  return (
    <form
      aria-label={name}
      className="grid grid-cols-2 gap-3 rounded-lg border p-3"
      onSubmit={(e) => void save(e)}
    >
      <p className="col-span-2 text-sm text-muted-foreground">
        {trip
          ? 'A trip you added by hand. Changes count in your totals at once.'
          : 'A trip the phone did not record. It counts in your totals and shows as edited.'}
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
      <SelectField label="Kind" value={form.kind} onChange={set('kind')} options={kinds} />
      <div className="col-span-2">
        <Field
          label="Purpose"
          maxLength={200}
          value={form.purpose}
          onChange={(e) => set('purpose')(e.target.value)}
        />
      </div>
      <div className="col-span-2 flex items-center gap-2">
        <Button
          type="submit"
          variant="tonal"
          busy={change.busy || form.distance.trim() === '' || form.purpose.trim() === ''}
        >
          {trip ? 'Save changes' : 'Add trip'}
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

/**
 * Asks before a manual trip is deleted (`DELETE /trips/{id}`): its distance leaves the shift's
 * totals, and the phone is told through the change feed (a `trip` delete, which both phone apps
 * already apply).
 */
export function DeleteTripDialog({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const { distance_unit: unit, timezone, time_format: timeFormat } = useSettings();
  const { run, busy, error } = useChange();
  const what = [
    formatDistance(trip.distance_m, unit),
    `${formatTime(trip.started_at, timezone, timeFormat)} to ${formatTime(trip.ended_at, timezone, timeFormat)}`,
    trip.purpose,
  ]
    .filter(Boolean)
    .join(', ');

  async function remove() {
    const done = await run((api) =>
      api.DELETE('/trips/{id}', { params: { path: { id: trip.id } } }),
    );
    if (done) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this trip?</DialogTitle>
          <DialogDescription>
            {what}. Its distance leaves this shift&apos;s totals, on the web and on your phone. This
            cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <FormError message={error} />
        <DialogFooter>
          <UiButton type="button" variant="ghost" onClick={onClose}>
            Cancel
          </UiButton>
          <UiButton
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() => void remove()}
          >
            Delete trip
          </UiButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
