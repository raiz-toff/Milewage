import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { DeleteIcon, EditIcon, FlagIcon } from '@/ui/icons';
import { RowMenu } from '../ui/RowMenu';
import { cn } from '@/lib/utils';
import type { Schemas } from '../api/client';
import { formatDistance, formatTime } from '../format';
import { useSettings } from '../session';
import { kindOf } from '../shift/view';
import type { Picked } from '../shift/view';

type Trip = Schemas['Trip'];
type Stop = Schemas['Stop'];
type Shift = Schemas['Shift'];

export type Entry =
  { kind: 'trip'; at: number; trip: Trip } | { kind: 'stop'; at: number; stop: Stop; n: number };

/** Trips and stops in time order. Stops are numbered 1, 2, … in time order, as on the map. */
export function timelineOf(trips: Trip[], stops: Stop[]): Entry[] {
  const numbered = [...stops]
    .sort((a, b) => a.started_at - b.started_at)
    .map((stop, i): Entry => ({ kind: 'stop', at: stop.started_at, stop, n: i + 1 }));
  return [
    ...trips.map((trip): Entry => ({ kind: 'trip', at: trip.started_at, trip })),
    ...numbered,
  ].sort((a, b) => a.at - b.at);
}

const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} min`;
const ROLE: Record<string, string> = { pickup: 'Pickup', dropoff: 'Dropoff', other: 'Other' };

/** The numbered dot of a stop; the map draws the same one. */
export function StopDot({ n, muted }: { n: number; muted?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded-full bg-foreground text-[11px] font-semibold text-background tabular-nums',
        muted && 'opacity-55',
      )}
    >
      {n}
    </span>
  );
}

function Row({
  time,
  mark,
  title,
  detail,
  on,
  onClick,
  menu,
}: {
  time: string;
  mark: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  on?: boolean;
  onClick?: () => void;
  /** The row's own actions (a manual trip's edit and delete), beside it, never inside the button. */
  menu?: ReactNode;
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
  const row = 'flex w-full min-w-0 items-start gap-3 rounded-medium px-2 py-2 text-left';
  const ref = useRef<HTMLButtonElement>(null);
  // Picked on the map: bring the entry into view inside the list's own scroll box, not the page.
  useEffect(() => {
    const el = ref.current;
    const box = el?.closest<HTMLElement>('[data-timeline-scroll]');
    if (!on || !el || !box || box.scrollHeight <= box.clientHeight) return;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (r.top < b.top) box.scrollTop -= b.top - r.top;
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
  }, [on]);
  return (
    <li className={menu ? 'flex items-start gap-1' : undefined}>
      {onClick ? (
        <button
          ref={ref}
          type="button"
          aria-pressed={on}
          onClick={onClick}
          className={cn(
            row,
            'relative state-layer focus-ring',
            on && 'bg-secondary-container text-on-secondary-container',
          )}
        >
          {body}
        </button>
      ) : (
        <div className={row}>{body}</div>
      )}
      {menu}
    </li>
  );
}

/**
 * The shift as a list in time order: start, each trip (time, distance, kind, purpose), each stop
 * (time, how long, what it was), end. It carries everything the map shows, so it is also the
 * map's text equivalent (WCAG 1.1.1). Choosing an entry picks it; choosing it again lets go.
 */
export function ShiftTimeline({
  shift,
  trips,
  stops,
  split,
  est,
  picked,
  onPick,
  onEditTrip,
  onDeleteTrip,
}: {
  shift: Shift;
  trips: Trip[];
  stops: Stop[];
  split: boolean;
  est: ReactNode;
  picked: Picked;
  onPick: (p: Picked) => void;
  /** Given while the shift can be changed: a manual trip's row offers Edit (TODO W2i). */
  onEditTrip?: (t: Trip) => void;
  /** Given while the shift can be changed: a manual trip's row offers Delete. */
  onDeleteTrip?: (t: Trip) => void;
}) {
  const { timezone: tz, distance_unit: unit } = useSettings();
  const flag = <FlagIcon aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" />;
  return (
    <ol aria-label="Timeline" className="-mx-2 space-y-0.5">
      <Row time={formatTime(shift.started_at, tz)} mark={flag} title="Shift started" />
      {timelineOf(trips, stops).map((e) => {
        if (e.kind === 'trip') {
          const t = e.trip;
          const kind = kindOf(t, split);
          const on = picked?.kind === 'trip' && picked.id === t.id;
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
              menu={
                t.source === 'manual' && onEditTrip && onDeleteTrip ? (
                  <RowMenu
                    name={`trip at ${formatTime(t.started_at, tz)}`}
                    actions={[
                      { label: 'Edit', icon: EditIcon, onSelect: () => onEditTrip(t) },
                      {
                        label: 'Delete',
                        icon: DeleteIcon,
                        destructive: true,
                        onSelect: () => onDeleteTrip(t),
                      },
                    ]}
                  />
                ) : undefined
              }
            />
          );
        }
        const s = e.stop;
        const on = picked?.kind === 'stop' && picked.key === s.stop_key;
        // A hand label, else the label a saved place gave (ADR 0008), else the estimate.
        const fromPlace = !s.label && s.place !== null && s.role !== 'none';
        const what = s.label
          ? ROLE[s.label.role]
          : fromPlace
            ? ROLE[s.role]
            : s.est_role === 'none'
              ? 'Stop'
              : ROLE[s.est_role];
        const where = s.label?.place || s.place?.name || s.label?.platform;
        return (
          <Row
            key={s.stop_key}
            time={formatTime(s.started_at, tz)}
            mark={<StopDot n={e.n} muted={s.confidence === 'low'} />}
            title={
              <>
                Stop {e.n} · {what}
                {!s.label && !fromPlace && s.est_role !== 'none' ? est : null}
                {where ? ` · ${where}` : ''}
              </>
            }
            detail={[minutes(s.dwell_s * 1000), s.confidence === 'low' ? 'low confidence' : '']
              .filter(Boolean)
              .join(' · ')}
            on={on}
            onClick={() => onPick(on ? null : { kind: 'stop', key: s.stop_key })}
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
