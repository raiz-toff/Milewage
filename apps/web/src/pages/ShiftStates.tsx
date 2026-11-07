import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { useSession } from '../session';
import { Button, FormError } from '../ui/form';
import { Section } from '../ui/layout';
import { AdviceList, CheckList, PERMISSIONS, adviceFor } from './ShiftFacts';

type Shift = Schemas['Shift'];

/** Under this length a shift with nothing recorded was most likely started by mistake. */
const SHORT_MIN = 3;

/**
 * In the map's place when an ended shift has nothing recorded: what happened, the likely reason
 * from the checks, and what to do next, in one card (NN/g and Carbon empty-state guidance). It
 * holds the checks, so the page shows no separate Checks card then.
 */
export function NoRouteCard({ shift, replay }: { shift: Shift; replay: boolean }) {
  const mins = shift.ended_at === null ? null : (shift.ended_at - shift.started_at) / 60_000;
  const short = mins !== null && mins < SHORT_MIN && !shift.total_m;
  // "No stops changed the estimate" says nothing more when nothing at all was recorded.
  const checks = { ...shift, flags: shift.flags?.filter((f) => f.code !== 'no_stops_detected') };
  const found = !!checks.flags?.length || !!shift.recon_status;
  return (
    <Section
      label="What happened"
      title={replay ? 'No route for this shift' : 'No trips for this shift'}
      description={
        replay
          ? 'The phone sent no location points for this shift, so there is no map, and no trips or stops.'
          : 'No trips or stops were recorded for this shift.'
      }
    >
      {short ? (
        <p className="text-sm">
          It lasted under {SHORT_MIN} minutes, so it may have been started by mistake. With no
          distance it adds nothing to your totals.
        </p>
      ) : null}
      {found ? (
        <div className="space-y-1.5">
          <h3 className="text-sm font-medium">What the checks found</h3>
          <CheckList shift={checks} />
        </div>
      ) : null}
      <AdviceList title="What you can do" advice={adviceFor(shift, [PERMISSIONS])} />
    </Section>
  );
}

/** In the map's place while the shift is still running on the phone. */
export function InProgressCard({ earnings }: { earnings: boolean }) {
  return (
    <Section label="In progress" title="Shift in progress">
      <p className="text-sm text-muted-foreground">
        The phone is still recording. It sends its positions in batches, about once a minute. The
        route, trips and stops are worked out when the shift ends, and appear here then.
      </p>
      {earnings ? (
        <p className="text-sm text-muted-foreground">
          Earnings can be entered once the shift has ended.
        </p>
      ) : null}
    </Section>
  );
}

export interface MoreRow {
  key: string;
  title: string;
  hint: string;
  open?: boolean;
  body: ReactNode;
}

/**
 * The quieter tools of a shift with little in it (odometer, notes, export), each folded under
 * its name so the page is not a column of empty cards (progressive disclosure).
 */
export function MoreCard({ rows }: { rows: MoreRow[] }) {
  return (
    <Section label="More" title="More for this shift">
      <div className="-mt-2 divide-y">
        {rows.map((r) => (
          <details key={r.key} open={r.open} className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0">
                <span className="block text-sm font-medium">{r.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{r.hint}</span>
              </span>
              <ChevronDown
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
              />
            </summary>
            <div className="pb-4">{r.body}</div>
          </details>
        ))}
      </div>
    </Section>
  );
}

/** The shift's notes, saved with the shift. */
export function ShiftNotes({
  shift,
  onShift,
  bare,
}: {
  shift: Shift;
  onShift: (s: Shift) => void;
  bare?: boolean;
}) {
  const { api } = useSession();
  const [notes, setNotes] = useState(shift.notes ?? '');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      const s = await unwrap(
        api.PATCH('/shifts/{ref}', {
          params: { path: { ref: String(shift.id) } },
          body: { notes: notes.trim() === '' ? null : notes },
        }),
      );
      onShift(s);
      setSaved(true);
    } catch (e) {
      setError(describe(e));
    }
  }

  return (
    <Section title="Notes" bare={bare}>
      <label className="sr-only" htmlFor="notes">
        Notes
      </label>
      <textarea
        id="notes"
        className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
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
        <Button type="button" busy={notes === (shift.notes ?? '')} onClick={() => void save()}>
          Save notes
        </Button>
        {saved ? (
          <span role="status" className="text-sm text-muted-foreground">
            Saved.
          </span>
        ) : null}
      </div>
    </Section>
  );
}
