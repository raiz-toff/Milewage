import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button as UiButton } from '@/components/ui/button';
import type { Schemas } from '../api/client';
import { put, useApiQuery, useChange } from '../api/query';
import { dayOf, startOfDay } from '../days';
import { useSettings } from '../session';
import { Button, DateField, Field, FormError, SelectField } from '../ui/form';
import { hhmm } from './AddTrip';

type Shift = Schemas['Shift'];

const MIN = 60_000;

/** A day and an "HH:MM" typed in the driver's time zone, as an instant; null when the time is not valid. */
function instant(day: string, clock: string, timeZone: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(clock);
  if (!day || !m) return null;
  return startOfDay(day, timeZone) + Number(m[1]) * 60 * MIN + Number(m[2]) * MIN;
}

/**
 * Corrects an ended shift's start and end time (the usual slip is forgetting to stop) and changes
 * its vehicle, in one inline form. Only what changed is sent. A new time makes the server work the
 * shift out again from the points inside it, so the distance, trips and stops may change.
 */
export function ShiftEdit({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const { timezone } = useSettings();
  const vehicles = useApiQuery('/vehicles').data ?? [];
  const ended = shift.status === 'ended' && shift.ended_at !== null;
  const [form, setForm] = useState({
    vehicle: String(shift.vehicle_id),
    startDay: dayOf(shift.started_at, timezone),
    startTime: hhmm(shift.started_at, timezone),
    endDay: shift.ended_at === null ? '' : dayOf(shift.ended_at, timezone),
    endTime: shift.ended_at === null ? '' : hhmm(shift.ended_at, timezone),
  });
  const change = useChange();
  const { error, setError } = change;
  const set = (k: keyof typeof form) => (v: string) => setForm({ ...form, [k]: v });

  async function save(e: FormEvent) {
    e.preventDefault();
    const body: { vehicle_id?: number; started_at?: number; ended_at?: number } = {};
    if (Number(form.vehicle) !== shift.vehicle_id) body.vehicle_id = Number(form.vehicle);
    if (ended) {
      // A time left as it was keeps its exact stored value.
      const was = {
        start: dayOf(shift.started_at, timezone) + hhmm(shift.started_at, timezone),
        end: dayOf(shift.ended_at!, timezone) + hhmm(shift.ended_at!, timezone),
      };
      const start =
        form.startDay + form.startTime === was.start
          ? shift.started_at
          : instant(form.startDay, form.startTime, timezone);
      const end =
        form.endDay + form.endTime === was.end
          ? shift.ended_at!
          : instant(form.endDay, form.endTime, timezone);
      if (start === null || end === null) return setError('Enter the times as hours and minutes.');
      if (end < start) return setError('The shift must end after it starts.');
      if (start !== shift.started_at) body.started_at = start;
      if (end !== shift.ended_at) body.ended_at = end;
    }
    if (Object.keys(body).length === 0) return onClose();
    const ref = String(shift.id);
    const saved = await change.run(
      (api) => api.PATCH('/shifts/{ref}', { params: { path: { ref } }, body }),
      (next) => [put('/shifts/{ref}', { path: { ref } }, next)],
    );
    if (saved) onClose();
  }

  return (
    <form
      aria-label="Edit shift"
      className="grid grid-cols-2 gap-3 rounded-lg border p-3"
      onSubmit={(e) => void save(e)}
    >
      <p className="col-span-2 text-body-medium text-muted-foreground">
        {ended
          ? 'Forgot to stop the shift, or started late? Correct the times. The distance is worked out again from the points inside them.'
          : 'Change the vehicle this shift was driven in.'}
      </p>
      {vehicles.length > 1 ? (
        <div className="col-span-2">
          <SelectField
            label="Vehicle"
            value={form.vehicle}
            onChange={set('vehicle')}
            options={vehicles.map((v) => ({ value: String(v.id), label: v.name }))}
          />
        </div>
      ) : null}
      {ended ? (
        <>
          <DateField label="Start date" value={form.startDay} onChange={set('startDay')} />
          <Field
            label="Start time"
            type="time"
            value={form.startTime}
            onChange={(e) => set('startTime')(e.target.value)}
          />
          <DateField label="End date" value={form.endDay} onChange={set('endDay')} />
          <Field
            label="End time"
            type="time"
            value={form.endTime}
            onChange={(e) => set('endTime')(e.target.value)}
          />
        </>
      ) : null}
      <div className="col-span-2 flex items-center gap-2">
        <Button type="submit" variant="tonal" busy={change.busy}>
          Save changes
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
