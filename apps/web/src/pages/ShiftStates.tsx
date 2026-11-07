import type { Schemas } from '../api/client';
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
