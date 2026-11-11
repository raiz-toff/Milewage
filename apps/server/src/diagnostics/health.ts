import type { EventRow } from './store';

export type State = 'green' | 'amber' | 'red' | 'na';
export interface Check {
  id: string;
  label: string;
  weight?: number;
  value: number | null;
  unit: string;
  state: State;
}

/** Thresholds of 16 section 10.1; all are (new) except where the spec cites `10`, and live in one place. */
export const HEALTH = {
  shifts: 7,
  batteryHistory: 10,
  coverage: { green: 1, amber: 3 }, // % of tracked time
  restarts: { green: 0, amber: 1 },
  fixQuality: { green: 85, amber: 70 }, // % of fixes at 25 m or better
  uploadFail: { green: 2, amber: 10 }, // %
  drainedWithinS: 900,
  battery: { green: 20, amber: 50 }, // % worse than own median
  rssMb: { green: 100, amber: 150 }, // 10 section 14 budgets
  lagP95Ms: { green: 50, amber: 100 },
  lagMaxMs: 1000,
  backupMaxAgeMs: 26 * 3600_000,
  fiveXxPct: { green: 0.5, amber: 2 },
} as const;
const WEIGHTS = { H1: 25, H2: 20, H3: 10, H4: 15, H5: 10, H6: 10, H7: 10 };

const by = (lowGood: boolean, v: number, green: number, amber: number): State =>
  lowGood
    ? v < green
      ? 'green'
      : v < amber
        ? 'amber'
        : 'red'
    : v >= green
      ? 'green'
      : v >= amber
        ? 'amber'
        : 'red';
const num = (e: EventRow, k: string) => Number(e.data[k] ?? 0);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0
    ? 0
    : s.length % 2
      ? s[(s.length - 1) / 2]!
      : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/**
 * The seven tracking checks and the 0 to 100 score for one device from its events (16 section 10.1): green earns the
 * whole weight, amber half, red none; a check without data is `na` and leaves the score's denominator.
 * Where the catalogue does not carry the quantity of the spec's wording, the check uses the nearest recorded one
 * and says so in its label (H1: windows with a long gap; H4: oldest pending age; H6: the shifts seen by the device).
 */
export function deviceHealth(
  events: readonly EventRow[],
  recon: readonly EventRow[],
): { shiftsConsidered: number; score: number; state: State; checks: Check[] } {
  const latest = new Map<string, number>();
  for (const e of events)
    if (e.shift) latest.set(e.shift, Math.max(latest.get(e.shift) ?? 0, e.at));
  const shifts = [...latest].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const recent = new Set(shifts.slice(0, HEALTH.shifts));
  const mine = events.filter((e) => e.shift && recent.has(e.shift));
  const of = (kind: string, from = mine) => from.filter((e) => e.kind === kind);

  const windows = of('track.window');
  const gapS = windows.reduce(
    (n, e) => n + Math.max(0, num(e, 'interval_max_ms') / 1000 - 60 - num(e, 'still_gated_s')),
    0,
  );
  const h1: Check = {
    id: 'H1',
    label: 'Coverage: time in long fix gaps (approximate)',
    weight: WEIGHTS.H1,
    unit: '%',
    value: windows.length ? (gapS / (windows.length * 600)) * 100 : null,
    state: 'na',
  };
  const restarts = of('service.event').filter(
    (e) =>
      e.data.event === 'restarted' ||
      (e.data.event === 'destroyed' &&
        ['os_kill_inferred', 'crash', 'unknown'].includes(String(e.data.reason))),
  ).length;
  const h2: Check = {
    id: 'H2',
    label: 'Service stability: unplanned restarts or kills',
    weight: WEIGHTS.H2,
    unit: 'count',
    value: of('service.event').length || windows.length ? restarts : null,
    state: 'na',
  };
  const hist = windows.reduce(
    (a, e) => (e.data.acc_hist as number[]).map((n, i) => n + (a[i] ?? 0)),
    [0, 0, 0, 0],
  );
  const fixes = hist.reduce((a, b) => a + b, 0);
  const h3: Check = {
    id: 'H3',
    label: 'Fix quality: share of fixes within 25 m',
    weight: WEIGHTS.H3,
    unit: '%',
    value: fixes ? ((hist[0]! + hist[1]!) / fixes) * 100 : null,
    state: 'na',
  };
  const up = of('upload.window');
  const attempts = up.reduce((n, e) => n + num(e, 'attempts'), 0);
  const failed = up.reduce(
    (n, e) =>
      n +
      num(e, 'fail_net') +
      num(e, 'fail_4xx') +
      num(e, 'fail_5xx') +
      num(e, 'fail_429') +
      num(e, 'fail_507'),
    0,
  );
  const lastUp = [...up].sort((a, b) => b.at - a.at)[0];
  const h4: Check = {
    id: 'H4',
    label: 'Uploads: failure rate and backlog drained',
    weight: WEIGHTS.H4,
    unit: '%',
    value: attempts ? (failed / attempts) * 100 : null,
    state: 'na',
  };
  const perm = [...events].filter((e) => e.kind === 'perm.state').sort((a, b) => b.at - a.at)[0];
  const h5: Check = {
    id: 'H5',
    label: 'Permissions and OS state',
    weight: WEIGHTS.H5,
    unit: 'bool',
    value: perm
      ? Number(
          perm.data.background === 'all_time' &&
            perm.data.battery_opt_ignored !== false &&
            perm.data.standby_bucket !== 'restricted',
        )
      : null,
    state: 'na',
  };
  const rec = recon.filter((e) => e.shift && recent.has(e.shift));
  const h6: Check = {
    id: 'H6',
    label: 'Agreement: phone and server results',
    weight: WEIGHTS.H6,
    unit: 'bool',
    value: rec.length ? Number(rec.every((e) => e.data.status !== 'differs')) : null,
    state: 'na',
  };
  const summaries = of(
    'shift.summary',
    events.filter((e) => e.shift),
  ).sort((a, b) => b.at - a.at);
  const rate = (e: EventRow) =>
    ((num(e, 'battery_start') - num(e, 'battery_end')) / Math.max(num(e, 'duration_s'), 1)) * 3600;
  const hist10 = summaries
    .slice(0, HEALTH.batteryHistory)
    .filter((e) => !e.data.charging_seen)
    .map(rate);
  const now7 = summaries.filter((e) => recent.has(e.shift!) && !e.data.charging_seen).map(rate);
  const base = median(hist10);
  const h7: Check = {
    id: 'H7',
    label: 'Battery against the device median',
    weight: WEIGHTS.H7,
    unit: '%',
    value:
      now7.length && base > 0
        ? (now7.reduce((a, b) => a + b, 0) / now7.length / base - 1) * 100
        : null,
    state: 'na',
  };

  if (h1.value !== null)
    h1.state = by(true, h1.value, HEALTH.coverage.green, HEALTH.coverage.amber);
  if (h2.value !== null)
    h2.state = h2.value <= HEALTH.restarts.green ? 'green' : h2.value <= 1 ? 'amber' : 'red';
  if (h3.value !== null)
    h3.state = by(false, h3.value, HEALTH.fixQuality.green, HEALTH.fixQuality.amber);
  if (h4.value !== null) {
    const drained = (lastUp ? num(lastUp, 'oldest_pending_s') : 0) <= HEALTH.drainedWithinS;
    h4.state =
      h4.value < HEALTH.uploadFail.green && drained
        ? 'green'
        : h4.value < HEALTH.uploadFail.amber
          ? 'amber'
          : 'red';
  }
  if (h5.value !== null)
    h5.state = h5.value === 1 ? 'green' : perm?.data.fine === false ? 'red' : 'amber';
  if (h6.value !== null) {
    const bad = rec.some((e) => (e.data.reasons as string[]).includes('engine_disagreement'));
    h6.state = h6.value === 1 ? 'green' : bad ? 'red' : 'amber';
  }
  if (h7.value !== null)
    h7.state = by(true, h7.value, HEALTH.battery.green + 0.0001, HEALTH.battery.amber + 0.0001);

  const checks = [h1, h2, h3, h4, h5, h6, h7];
  const live = checks.filter((c) => c.state !== 'na');
  const total = live.reduce((n, c) => n + (c.weight ?? 0), 0);
  const earned = live.reduce(
    (n, c) => n + (c.weight ?? 0) * (c.state === 'green' ? 1 : c.state === 'amber' ? 0.5 : 0),
    0,
  );
  const score = total ? Math.round((earned / total) * 100) : 0;
  return {
    shiftsConsidered: recent.size,
    score,
    state: total ? (score >= 80 ? 'green' : score >= 50 ? 'amber' : 'red') : 'na',
    checks,
  };
}

/** S1 to S5 (no score), from the last 24 hours of the server's own events and two live facts. */
export function serverHealth(
  samples: readonly EventRow[],
  windows: readonly EventRow[],
  backupAgeMs: number | null,
  diskState: string,
): { state: State; checks: Check[] } {
  const max = (k: string) => (samples.length ? Math.max(...samples.map((e) => num(e, k))) : null);
  const rss = max('rss_mb');
  const p95 = max('lag_p95_ms');
  const lagMax = max('lag_max_ms');
  const n = windows.reduce((a, e) => a + num(e, 'n'), 0);
  const s5 = windows.reduce((a, e) => a + num(e, 's5xx'), 0);
  const pct5 = n ? (s5 / n) * 100 : null;
  const checks: Check[] = [
    {
      id: 'S1',
      label: 'Memory (RSS, 24 h max)',
      unit: 'MB',
      value: rss,
      state: rss === null ? 'na' : by(true, rss + 0.001, HEALTH.rssMb.green, HEALTH.rssMb.amber),
    },
    {
      id: 'S2',
      label: 'Event-loop lag (p95, 24 h max)',
      unit: 'ms',
      value: p95,
      state:
        p95 === null
          ? 'na'
          : lagMax! >= HEALTH.lagMaxMs
            ? 'red'
            : by(true, p95 + 0.001, HEALTH.lagP95Ms.green + 0.002, HEALTH.lagP95Ms.amber),
    },
    {
      id: 'S3',
      label: 'Last verified backup age',
      unit: 'h',
      value: backupAgeMs === null ? null : Math.round(backupAgeMs / 360_000) / 10,
      state: backupAgeMs === null ? 'na' : backupAgeMs < HEALTH.backupMaxAgeMs ? 'green' : 'red',
    },
    {
      id: 'S4',
      label: 'Disk state',
      unit: 'state',
      value: null,
      state: diskState === 'ok' ? 'green' : diskState === 'writes_blocked' ? 'red' : 'amber',
    },
    {
      id: 'S5',
      label: 'Server errors (5xx share, 24 h)',
      unit: '%',
      value: pct5,
      state: pct5 === null ? 'na' : by(true, pct5, HEALTH.fiveXxPct.green, HEALTH.fiveXxPct.amber),
    },
  ];
  const live = checks.filter((c) => c.state !== 'na');
  const state: State =
    live.length === 0
      ? 'na'
      : live.some((c) => c.state === 'red')
        ? 'red'
        : live.some((c) => c.state === 'amber')
          ? 'amber'
          : 'green';
  return { state, checks };
}
