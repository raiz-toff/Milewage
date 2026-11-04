import { statfsSync, statSync } from 'node:fs';

/** Free-space rules of 10 section 11.3, strictest last. */
export type DiskState = 'ok' | 'warning' | 'backup_skipped' | 'writes_blocked';

export const DISK_LIMITS = {
  /** Below this every mutating route answers 507. */
  writesBlockedBelow: 200 * 1024 * 1024,
  /** Below this (or below `warnFraction` of the volume) the status page warns. */
  warnBelow: 1024 ** 3,
  warnFraction: 0.1,
} as const;

export interface DiskSnapshot {
  freeBytes: number;
  totalBytes: number;
  /** milewage.db plus its WAL. */
  dbBytes: number;
  state: DiskState;
}

/** The table of 10 section 11.3. A backup needs room for a full copy, so "below 2x the DB" skips it. */
export function diskStateOf(freeBytes: number, totalBytes: number, dbBytes: number): DiskState {
  if (freeBytes < DISK_LIMITS.writesBlockedBelow) return 'writes_blocked';
  if (freeBytes < 2 * dbBytes) return 'backup_skipped';
  if (freeBytes < DISK_LIMITS.warnBelow || freeBytes < totalBytes * DISK_LIMITS.warnFraction) {
    return 'warning';
  }
  return 'ok';
}

export interface DiskMonitor {
  snapshot(): DiskSnapshot;
  state(): DiskState;
}

export interface DiskMonitorOptions {
  /** Directory on the data volume. */
  dir: string;
  /** The database file, for its size and its WAL's. */
  dbPath: string;
  now: () => number;
  /** Read at most this often; statfs is cheap but every write asks. */
  ttlMs?: number;
  /** Test seam: size of the database and its WAL. */
  dbBytes?: () => number;
  /** Test seam: free and total bytes of the volume. */
  statfs?: (dir: string) => { free: number; total: number };
}

const realStatfs = (dir: string) => {
  const s = statfsSync(dir);
  return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
};
const size = (path: string) => {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
};

export function createDiskMonitor(o: DiskMonitorOptions): DiskMonitor {
  const read = o.statfs ?? realStatfs;
  let cached: { at: number; snap: DiskSnapshot } | undefined;
  const snapshot = (): DiskSnapshot => {
    const t = o.now();
    if (cached && t - cached.at < (o.ttlMs ?? 1000) && t >= cached.at) return cached.snap;
    const { free, total } = read(o.dir);
    const dbBytes = o.dbBytes?.() ?? size(o.dbPath) + size(`${o.dbPath}-wal`);
    const snap = {
      freeBytes: free,
      totalBytes: total,
      dbBytes,
      state: diskStateOf(free, total, dbBytes),
    };
    cached = { at: t, snap };
    return snap;
  };
  return { snapshot, state: () => snapshot().state };
}
