import { lazy, Suspense, useEffect, useReducer, useState } from 'react';
import { Link } from 'react-router-dom';
import { connectLive } from '../live/connection';
import type { LinkStatus } from '../live/connection';
import { applyFrame, initialLive, mergeTrail } from '../live/state';
import type { LiveFrame, LiveState } from '../live/state';
import { formatDistance, formatDuration, formatTime } from '../format';
import { toPoints } from '../map/route';
import type { RoutePoint } from '../map/route';
import { speedIn } from '../map/route';
import { useSession, useSettings } from '../session';

const LiveMap = lazy(() => import('../map/LiveMap'));

type Action = { frame: LiveFrame } | { backfill: RoutePoint[]; shiftId: number };

function reduce(state: LiveState, a: Action): LiveState {
  if ('frame' in a) return applyFrame(state, a.frame);
  return state.shift?.id === a.shiftId
    ? { ...state, trail: mergeTrail(a.backfill, state.trail) }
    : state;
}

const STATUS_TEXT: Record<LinkStatus, string> = {
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Connection lost. Reconnecting',
};

/**
 * Live map (module `live`): the active shift's position as the phone reports it. A shift that
 * is already running is filled in from its stored route (module `replay`) when the socket
 * connects, then new positions are added as they arrive.
 */
export function LivePage() {
  const { api } = useSession();
  const settings = useSettings();
  const [state, dispatch] = useReducer(reduce, initialLive);
  const [link, setLink] = useState<LinkStatus>('connecting');
  const [follow, setFollow] = useState(true);
  const replay = settings.modules.replay;
  const shiftId = state.shift?.id ?? null;
  const running = state.shift?.status === 'active';

  useEffect(() => {
    const conn = connectLive(globalThis.location.origin, {
      frame: (frame) => dispatch({ frame }),
      status: setLink,
    });
    return () => conn.close();
  }, []);

  // Fill in the part of a running shift that happened before the socket opened.
  useEffect(() => {
    if (shiftId === null || !running || !replay || state.helloAt === null) return;
    let live = true;
    void api
      .GET('/shifts/{ref}/route', { params: { path: { ref: String(shiftId) } } })
      .then((r) => {
        if (live && r.data) dispatch({ backfill: toPoints(r.data), shiftId });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Once per hello (so once per connection) and shift.
  }, [api, shiftId, running, replay, state.helloAt]);

  const last = state.trail[state.trail.length - 1] ?? null;
  const tz = settings.timezone;
  const anyOnline = Object.values(state.devices).some(Boolean);
  const known = Object.keys(state.devices).length > 0;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl">Live map</h1>
        <p role="status" aria-label="Connection" className="text-sm text-muted">
          {STATUS_TEXT[link]}
        </p>
      </div>

      {state.shift === null || !running ? (
        <p className="text-muted">
          {state.shift ? 'The shift has ended. ' : link === 'live' ? 'No shift is running. ' : ''}
          Finished shifts are under{' '}
          <Link className="text-accent" to="/shifts">
            Shifts
          </Link>
          .
        </p>
      ) : (
        <dl className="grid max-w-xl grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-muted">Started</dt>
          <dd className="font-mono">{formatTime(state.shift.started_at, tz)}</dd>
          <dt className="text-muted">Elapsed*</dt>
          <dd className="font-mono">
            {formatDuration(state.shift.started_at, Math.max(last?.t ?? 0, state.helloAt ?? 0))}
          </dd>
          <dt className="text-muted">Distance</dt>
          <dd className="font-mono">
            {formatDistance(state.shift.total_m, settings.distance_unit)}
          </dd>
          <dt className="text-muted">Phone</dt>
          <dd>{known ? (anyOnline ? 'online' : 'offline') : 'unknown'}</dd>
        </dl>
      )}
      {running ? (
        <p className="text-xs text-muted">* as of the latest update from the phone</p>
      ) : null}
      {state.stopCount !== null && settings.modules.stops ? (
        <p className="text-sm text-muted">
          {state.stopCount} {state.stopCount === 1 ? 'stop' : 'stops'} detected so far (estimated).
        </p>
      ) : null}

      <Suspense fallback={<p className="text-muted">Loading map</p>}>
        <LiveMap trail={state.trail} follow={follow} />
      </Suspense>
      <div className="flex items-center justify-between gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          Follow the newest position
        </label>
        {last ? (
          <output className="font-mono text-muted">
            {formatTime(last.t, tz)} · {speedIn(last.speed, settings.distance_unit)}
          </output>
        ) : (
          <span className="text-muted">No position yet.</span>
        )}
      </div>
    </section>
  );
}
