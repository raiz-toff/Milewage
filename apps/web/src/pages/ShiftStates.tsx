import { useState } from 'react';
import { Button as UiButton } from '@/components/ui/button';
import type { Schemas } from '../api/client';
import { put, useChange } from '../api/query';
import { Button, FormError, denseField } from '../ui/form';
import { cn } from '@/lib/utils';
import { Section } from '../ui/layout';
import { PERMISSIONS, adviceFor } from '../shift/advice';
import { AdviceList, CheckList } from './ShiftFacts';

type Shift = Schemas['Shift'];

/** Under this length a shift with nothing recorded was most likely started by mistake. */
const SHORT_MIN = 3;

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
  const mins = shift.ended_at === null ? null : (shift.ended_at - shift.started_at) / 60_000;
  const short = mins !== null && mins < SHORT_MIN && !shift.total_m;
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
      {short ? (
        <p className="text-body-medium">
          It lasted under {SHORT_MIN} minutes, so it may have been started by mistake. With no
          distance it adds nothing to your totals.
        </p>
      ) : null}
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

/** In the map's place while the shift is still running on the phone. */
export function InProgressCard({ earnings }: { earnings: boolean }) {
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
