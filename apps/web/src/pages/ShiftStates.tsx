import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button as UiButton } from '@/components/ui/button';
import { FlagIcon } from '@/ui/icons';
import type { Schemas } from '../api/client';
import { put, useChange } from '../api/query';
import { formatDateTime, formatDistance } from '../format';
import { useSettings } from '../session';
import { shortDuration } from '../shift/checks';
import { Button, FormError, denseField } from '../ui/form';
import { cn } from '@/lib/utils';
import { Section } from '../ui/layout';
import { PERMISSIONS, adviceFor } from '../shift/advice';
import { AdviceList, CheckList } from './ShiftFacts';

type Shift = Schemas['Shift'];

/**
 * In the map's place when an ended shift has nothing recorded: what happened, the likely reason
 * from the checks, and what to do next, in one card (NN/g and Carbon empty-state guidance). It
 * holds the checks, so the page shows no separate Checks card then.
 */
export function NoRouteCard({
  shift,
  tracking,
  onAdd,
}: {
  shift: Shift;
  tracking: boolean;
  /** Opens the add-a-trip form; absent when the shift cannot be changed. */
  onAdd?: () => void;
}) {
  // "No stops changed the estimate" says nothing more when nothing at all was recorded.
  const checks = { ...shift, flags: shift.flags?.filter((f) => f.code !== 'no_stops_detected') };
  const found = !!checks.flags?.length || !!shift.recon_status;
  return (
    <Section
      label="What happened"
      title={tracking ? 'No route for this shift' : 'No trips for this shift'}
      description={
        tracking
          ? 'The phone sent no location points for this shift, so there is no map, and no trips or stops.'
          : 'No trips or stops were recorded for this shift.'
      }
    >
      {found ? (
        <div className="space-y-1.5">
          <h3 className="text-title-small">What the checks found</h3>
          <CheckList shift={checks} />
        </div>
      ) : null}
      <AdviceList title="What you can do" advice={adviceFor(shift, [PERMISSIONS])} />
      {onAdd && shift.status === 'ended' ? (
        <div className="flex flex-wrap items-center gap-3 text-body-medium">
          <span className="text-muted-foreground">
            If you know the distance (from the odometer or the platform), add it by hand.
          </span>
          <UiButton variant="outline" size="sm" onClick={onAdd}>
            Add a trip
          </UiButton>
        </div>
      ) : null}
    </Section>
  );
}

/**
 * A shift under 2 minutes and 0.1 mi with no earnings, costs or trips added by hand (the rule is in
 * `shift/checks.ts`): asks whether it was started by mistake, and offers Delete. Nothing is deleted
 * without the confirm the shift page's Delete shift asks for.
 */
export function AccidentalShiftNotice({ shift, onDelete }: { shift: Shift; onDelete: () => void }) {
  const { distance_unit: unit } = useSettings();
  if (shift.ended_at === null) return null;
  return (
    <Alert role="note">
      <FlagIcon />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3 text-foreground">
        <span>
          This shift is {shortDuration(shift.ended_at - shift.started_at)} and{' '}
          {formatDistance(shift.total_m ?? 0, unit)}. Started by mistake?
        </span>
        <UiButton variant="outline" size="sm" onClick={onDelete}>
          Delete
        </UiButton>
      </AlertDescription>
    </Alert>
  );
}

/**
 * A running shift with nothing recorded for 12 hours (the server's `stale_active_shift`). The
 * server never ends it; End now does, at this moment, and the times can be corrected after.
 */
export function StaleShiftNotice({ shift }: { shift: Shift }) {
  const { timezone, time_format: tf } = useSettings();
  const change = useChange();
  const at = (
    shift.flags?.find((f) => f.code === 'stale_active_shift')?.detail as
      { at?: number | null } | null | undefined
  )?.at;
  const ref = String(shift.id);
  const endNow = () =>
    change.run((api) =>
      api.POST('/shifts/{ref}/end', { params: { path: { ref } }, body: { ended_at: Date.now() } }),
    );
  return (
    <Alert role="note">
      <FlagIcon />
      <AlertDescription className="space-y-2 text-foreground">
        <p>
          This shift is still running, but nothing has been recorded since{' '}
          {formatDateTime(at ?? shift.started_at, timezone, tf)}. Did it end earlier?
        </p>
        <UiButton variant="outline" size="sm" disabled={change.busy} onClick={() => void endNow()}>
          End now
        </UiButton>
        <FormError message={change.error} />
      </AlertDescription>
    </Alert>
  );
}

/**
 * In the map's place while the shift is still running on the phone. A shift the phone never ended
 * (a dead battery, a forgotten stop) is ended here: End now stops it at this moment, and the times
 * can be corrected after.
 */
export function InProgressCard({ shift, earnings }: { shift: Shift; earnings: boolean }) {
  const change = useChange();
  const ref = String(shift.id);
  const endNow = () =>
    change.run((api) =>
      api.POST('/shifts/{ref}/end', { params: { path: { ref } }, body: { ended_at: Date.now() } }),
    );
  return (
    <Section label="In progress" title="Shift in progress">
      <p className="text-body-medium text-muted-foreground">
        The phone is still recording. It sends its positions in batches, about once a minute. The
        route, trips and stops are worked out when the shift ends, and appear here then.
      </p>
      {earnings ? (
        <p className="text-body-medium text-muted-foreground">
          Earnings can be entered once the shift has ended.
        </p>
      ) : null}
      <p className="text-body-medium text-muted-foreground">
        Not recording any more, or forgot to stop it? End it here at this moment, then correct the
        end time if it was earlier.
      </p>
      <div>
        <Button type="button" variant="tonal" busy={change.busy} onClick={() => void endNow()}>
          End now
        </Button>
      </div>
      <FormError message={change.error} />
    </Section>
  );
}

/** The shift's notes, saved with the shift. */
export function ShiftNotes({ shift, bare }: { shift: Shift; bare?: boolean }) {
  const [notes, setNotes] = useState(shift.notes ?? '');
  const [saved, setSaved] = useState(false);
  const change = useChange();
  const { error } = change;

  async function save() {
    const path = { ref: String(shift.id) };
    const done = await change.run(
      (api) =>
        api.PATCH('/shifts/{ref}', {
          params: { path },
          body: { notes: notes.trim() === '' ? null : notes },
        }),
      // The answer is the shift: shown at once; the week and the totals are read again.
      (next) => [put('/shifts/{ref}', { path }, next)],
    );
    if (done) setSaved(true);
  }

  return (
    <Section title="Notes" bare={bare}>
      <label className="sr-only" htmlFor="notes">
        Notes
      </label>
      <textarea
        id="notes"
        className={cn(denseField, 'h-auto py-2')}
        rows={3}
        maxLength={2000}
        value={notes}
        onChange={(e) => {
          setSaved(false);
          setNotes(e.target.value);
        }}
      />
      <FormError message={error} />
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="tonal"
          busy={notes === (shift.notes ?? '')}
          onClick={() => void save()}
        >
          Save notes
        </Button>
        {saved ? (
          <span role="status" className="text-body-medium text-muted-foreground">
            Saved.
          </span>
        ) : null}
      </div>
    </Section>
  );
}
