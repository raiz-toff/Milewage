import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { ApiError, unwrap } from '../api/client';
import { formatTime } from '../format';
import { useSession, useSettings } from '../session';
import { positionAt, speedIn, timeAt, toPoints } from './route';
import type { RoutePoint } from './route';

const MapView = lazy(() => import('./MapView'));
const STEPS = 1000;

/** Route map and replay scrubber for one shift (module `replay`). */
export function RouteView({ shiftId }: { shiftId: number }) {
  const { api } = useSession();
  const settings = useSettings();
  const [points, setPoints] = useState<RoutePoint[] | null>(null);
  const [source, setSource] = useState<'raw' | 'archive'>('raw');
  const [note, setNote] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    let live = true;
    void unwrap(api.GET('/shifts/{ref}/route', { params: { path: { ref: String(shiftId) } } }))
      .then((r) => {
        if (!live) return;
        setSource(r.source);
        setPoints(toPoints(r));
        setStep(0);
      })
      .catch((e) => {
        if (!live) return;
        setPoints([]);
        // 404 is the normal "no route" answer: replay off on the server, or nothing recorded.
        setNote(
          e instanceof ApiError && e.status === 404
            ? 'No route is available for this shift.'
            : 'The route could not be loaded.',
        );
      });
    return () => {
      live = false;
    };
  }, [api, shiftId]);

  const cursor = useMemo(
    () => (points && points.length ? positionAt(points, timeAt(points, step, STEPS)) : null),
    [points, step],
  );

  if (points === null) return <p className="text-muted">Loading route</p>;
  if (points.length === 0)
    return <p className="text-muted">{note ?? 'No route points were recorded.'}</p>;

  const tz = settings.timezone;
  return (
    <section aria-label="Route" className="space-y-3">
      <h2 className="font-heading text-lg">Route</h2>
      <Suspense fallback={<p className="text-muted">Loading map</p>}>
        <MapView points={points} cursor={cursor} />
      </Suspense>
      <div className="flex items-center gap-4">
        <input
          type="range"
          aria-label="Replay position"
          className="flex-1 accent-[var(--mw-accent)]"
          min={0}
          max={STEPS}
          value={step}
          onChange={(e) => setStep(Number(e.target.value))}
        />
        {cursor ? (
          <output className="w-64 font-mono text-sm text-muted">
            {formatTime(cursor.t, tz)} · {speedIn(cursor.speed, settings.distance_unit)}
          </output>
        ) : null}
      </div>
      {cursor ? (
        <p className="font-mono text-xs text-muted">
          {cursor.lat.toFixed(5)}, {cursor.lon.toFixed(5)}
        </p>
      ) : null}
      {source === 'archive' ? (
        <p className="text-sm text-muted">
          Simplified route: raw points were archived (speed unavailable).
        </p>
      ) : null}
    </section>
  );
}
