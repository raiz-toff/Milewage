import type { ReactNode } from 'react';
import { Flag } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Schemas } from '../api/client';
import { formatDistance, formatTime } from '../format';
import { useSettings } from '../session';
import { kindOf } from './Trips';

type Trip = Schemas['Trip'];
type Shift = Schemas['Shift'];

/** The trip chosen in the timeline. */
export type Picked = { kind: 'trip'; id: number } | null;

const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} min`;
function Row({
  time,
  mark,
  title,
  detail,
  on,
  onClick,
}: {
  time: string;
  mark: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  on?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="w-11 shrink-0 pt-px text-xs text-muted-foreground tabular-nums">{time}</span>
      <span className="flex w-5 shrink-0 justify-center self-stretch">{mark}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{title}</span>
        {detail ? (
          <span className="block text-xs text-muted-foreground tabular-nums">{detail}</span>
        ) : null}
      </span>
    </>
  );
  const row = 'flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left';
  return (
    <li>
      {onClick ? (
        <button
          type="button"
          aria-pressed={on}
          onClick={onClick}
          className={cn(
            row,
            'transition-colors hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
            on && 'bg-accent ring-1 ring-primary/60',
          )}
        >
          {body}
        </button>
      ) : (
        <div className={row}>{body}</div>
      )}
    </li>
  );
}

/**
 * The shift as a list in time order: start, each trip (time, distance, kind, purpose), end. It is
 * the text equivalent of the map (WCAG 1.1.1). Choosing an entry picks it; again lets go.
 */
export function ShiftTimeline({
  shift,
  trips,
  split,
  est,
  picked,
  onPick,
}: {
  shift: Shift;
  /** In time order, as the server sends them. */
  trips: Trip[];
  split: boolean;
  est: ReactNode;
  picked: Picked;
  onPick: (p: Picked) => void;
}) {
  const { timezone: tz, distance_unit: unit } = useSettings();
  const flag = <Flag aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" />;
  return (
    <ol aria-label="Timeline" className="-mx-2 space-y-0.5">
      <Row time={formatTime(shift.started_at, tz)} mark={flag} title="Shift started" />
      {trips.map((t) => {
        const kind = kindOf(t, split);
        const on = picked?.id === t.id;
        return (
          <Row
            key={`t${t.id}`}
            time={formatTime(t.started_at, tz)}
            mark={
              <span
                className={cn(
                  'w-1 rounded-full',
                  t.kind === 'personal' ? 'bg-muted-foreground/40' : 'bg-primary',
                  t.kind === 'deadhead' && split && 'bg-primary/45',
                )}
              />
            }
            title={
              <>
                Trip · {formatDistance(t.distance_m, unit)} · {kind.text}
                {kind.estimated ? est : null}
              </>
            }
            detail={[
              `${formatTime(t.started_at, tz)} – ${formatTime(t.ended_at, tz)}`,
              minutes(t.ended_at - t.started_at),
              t.purpose,
              t.source === 'manual' ? 'edited' : '',
            ]
              .filter(Boolean)
              .join(' · ')}
            on={on}
            onClick={() => onPick(on ? null : { kind: 'trip', id: t.id })}
          />
        );
      })}
      <Row
        time={shift.ended_at ? formatTime(shift.ended_at, tz) : 'now'}
        mark={flag}
        title={shift.ended_at ? 'Shift ended' : 'Shift in progress'}
      />
    </ol>
  );
}
