import type { ModuleJob } from '@milewage/shared';
import { algorithmVersion, simplifyRoute, type RoutePoint } from '@milewage/track-engine';
import {
  createArchiveRepository,
  createProcessingRepository,
  createSettingsRepository,
  type Db,
  type PointRow,
} from '../db';
import type { EventEmit } from '../events';

const DAY = 24 * 60 * 60 * 1000;
/** Douglas-Peucker tolerance of the archive (07 section 4.2); the display route uses 10 m. */
export const ARCHIVE_TOLERANCE_M = 5;
/** An unfinalized shift is archived anyway after this many days (07 section 4.2). */
export const ARCHIVE_UNFINALIZED_DAYS = 180;
const BATCH = 25;

/**
 * Douglas-Peucker with a 5 m tolerance that always keeps the first and last point and the first and last
 * fix of every stop (their times in `keepTimes`), so destinations survive. Each stretch between two kept
 * points is simplified on its own, so a kept point can never be dropped by a neighbour.
 */
export function simplifyKeeping(points: readonly PointRow[], keepTimes: readonly number[]) {
  const n = points.length;
  if (n === 0) return { coordinates: [] as [number, number][], times: [] as number[] };
  const keep = new Set<number>([0, n - 1]);
  for (const t of keepTimes) {
    let best = 0;
    for (let i = 1; i < n; i++) {
      if (Math.abs(points[i]!.t - t) < Math.abs(points[best]!.t - t)) best = i;
    }
    keep.add(best);
  }
  const anchors = [...keep].sort((a, b) => a - b);
  const stretches: RoutePoint[][] = [];
  if (anchors.length === 1) {
    stretches.push([{ latE7: points[0]!.latE7, lonE7: points[0]!.lonE7, t: points[0]!.t }]);
  }
  for (let k = 0; k + 1 < anchors.length; k++) {
    const stretch: RoutePoint[] = points
      .slice(anchors[k]!, anchors[k + 1]! + 1)
      .map((p) => ({ latE7: p.latE7, lonE7: p.lonE7, t: p.t }));
    const kept = simplifyRoute(stretch, ARCHIVE_TOLERANCE_M * 10);
    stretches.push(k === 0 ? kept : kept.slice(1));
  }
  const out = stretches.flat();
  return {
    coordinates: out.map((p) => [p.lonE7 / 1e7, p.latE7 / 1e7] as [number, number]),
    times: out.map((p) => Math.round(p.t / 1000)),
  };
}

export interface ArchiverOptions {
  db: Db;
  now: () => number;
  emit: () => EventEmit | undefined;
  /** How often the job runs (a day unless a test shortens it). */
  everyMs?: number;
  log?: (message: string, fields?: object) => void;
}

/**
 * Raw-point retention (07 section 4.2): once a shift is finalized, computed with the current
 * `calc_version` and older than `raw_retention_days`, its points are replaced by a simplified route in
 * `route_archives`, written and read back in the same transaction as the delete. Totals and trips are
 * untouched. An unfinalized shift goes the same way after the longer of the window and 180 days, with
 * an `archived_unfinalized` flag as the notice for the web UI.
 */
export function createArchiver({ db, now, emit, everyMs = DAY, log }: ArchiverOptions) {
  const archive = createArchiveRepository(db);
  const processing = createProcessingRepository(db);
  const settings = createSettingsRepository(db);

  const run = (): number => {
    let done = 0;
    for (const c of archive.candidates()) {
      if (done >= BATCH) break;
      const days = settings.get(c.userId)?.rawRetentionDays ?? 90;
      const finalized = c.status === 'finalized';
      const due = finalized
        ? c.calcVersion === algorithmVersion && c.endedAt <= now() - days * DAY
        : c.endedAt <= now() - Math.max(days, ARCHIVE_UNFINALIZED_DAYS) * DAY;
      if (!due) continue;
      try {
        const points = archive.pointsOf(c.id);
        const keep = processing.stopsOf(c.id).flatMap((s) => [s.startedAt, s.endedAt]);
        const g = simplifyKeeping(points, keep);
        archive.replacePoints(
          {
            shiftId: c.id,
            userId: c.userId,
            geometry: JSON.stringify({
              type: 'LineString',
              coordinates: g.coordinates,
              properties: { times: g.times },
            }),
            rawPointCount: points.length,
            keptPointCount: g.coordinates.length,
            toleranceM: ARCHIVE_TOLERANCE_M,
            archivedAt: now(),
          },
          finalized
            ? undefined
            : { code: 'archived_unfinalized', detail: JSON.stringify({ at: null, detail: null }) },
        );
        done++;
        if (!finalized) emit()?.('shift.updated', { shiftId: String(c.id) });
      } catch (e) {
        log?.('route archive failed', { shiftId: c.id, error: (e as Error).message });
      }
    }
    return done;
  };

  const job: ModuleJob = {
    name: 'route-archive',
    start() {
      const first = setTimeout(run, Math.min(60_000, everyMs));
      const timer = setInterval(run, everyMs);
      first.unref();
      timer.unref();
      return () => {
        clearTimeout(first);
        clearInterval(timer);
      };
    },
  };
  return { run, job };
}
