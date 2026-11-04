import { BACKUP_FILE } from './engine';

export const RETENTION = {
  daily: 7,
  weekly: 4,
  monthly: 12,
  preMigration: 3,
  preRestore: 2,
} as const;

/** Epoch ms parsed from a backup file name (`milewage-20261104T033000123Z.db.gz.age`). */
export function fileTime(name: string): number | undefined {
  const m = BACKUP_FILE.exec(name.split('/').pop() ?? '');
  if (!m) return undefined;
  const s = m[1]!;
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}.${s.slice(15, 18)}Z`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : t;
}

/** Local calendar date and weekday of an instant in an IANA zone. */
function localDay(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(ms);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    day: get('day'),
    sunday: get('weekday') === 'Sun',
  };
}

/**
 * Which tiered backups (10 section 5) to keep: the newest file of each of the last 7 days that have
 * one, of the last 4 Sundays, and of the last 12 first-of-the-month days, by the instance's local
 * calendar. Returns the names to delete. Files whose name has no timestamp are never touched.
 */
export function selectExpired(names: readonly string[], timeZone: string): string[] {
  const dated = names
    .map((name) => ({ name, t: fileTime(name) }))
    .filter((f): f is { name: string; t: number } => f.t !== undefined)
    .sort((a, b) => b.t - a.t);
  const newestPerDay = new Map<string, { name: string; sunday: boolean; first: boolean }>();
  for (const f of dated) {
    const d = localDay(f.t, timeZone);
    if (!newestPerDay.has(d.date)) {
      newestPerDay.set(d.date, { name: f.name, sunday: d.sunday, first: d.day === '01' });
    }
  }
  const days = [...newestPerDay.values()]; // newest day first
  const keep = new Set<string>([
    ...days.slice(0, RETENTION.daily).map((d) => d.name),
    ...days
      .filter((d) => d.sunday)
      .slice(0, RETENTION.weekly)
      .map((d) => d.name),
    ...days
      .filter((d) => d.first)
      .slice(0, RETENTION.monthly)
      .map((d) => d.name),
  ]);
  return dated.map((f) => f.name).filter((n) => !keep.has(n));
}

/** All but the newest `keep` files (used for `pre-migration/` and `pre-restore/`). */
export function selectExcess(names: readonly string[], keep: number): string[] {
  return names
    .filter((n) => fileTime(n) !== undefined)
    .sort((a, b) => fileTime(b)! - fileTime(a)!)
    .slice(keep);
}
