import { BADGES, type ModuleRegistry } from '@milewage/shared';
import { createEarningsRepository, createSettingsRepository, totalOf, type Db } from './db';
import { notify } from './notifications';
import { periodRange } from './goal-progress';
import { createEarningsPolicy } from './routes/earnings';
import { localDate } from './time';

const DAY = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export interface ProgressContext {
  db: Db;
  now: () => number;
  registry: ModuleRegistry;
  override?: 'replace' | 'sum';
  /** Weekly "earn" challenge target in minor units (`comma.challenge_target_cents`). */
  challengeTargetCents: number;
  emit?: Parameters<typeof notify>[0]['emit'];
}

/** XP: shift +10, a shift of 4 hours or more +15 (assumed target), a new longest-distance shift +30, badge +40, challenge +60. */
export const XP = { shift: 10, long: 15, record: 30, badge: 40, challenge: 60 } as const;
const LONG_MS = 4 * 3_600_000;

interface Shift {
  id: number;
  localDate: string;
  startedAt: number;
  ms: number;
  totalM: number;
}

/**
 * Evaluates the driver's progress now (18 section 8.2) and records what became true: new badge unlocks,
 * freezes granted by level-ups and used by the streak, and completed weekly challenges. Idempotent:
 * a second call with the same data records nothing new. Everything else is derived.
 */
export function evaluateProgress(c: ProgressContext, userId: number) {
  const prefs = createSettingsRepository(c.db).get(userId)!;
  const today = localDate(c.now(), prefs.timezone);
  const shifts = c.db
    .prepare(
      `SELECT id, local_date AS localDate, started_at AS startedAt, coalesce(ended_at, started_at) - started_at AS ms, coalesce(total_m, 0) AS totalM
           FROM shifts WHERE user_id = ? AND status IN ('ended','finalized') ORDER BY started_at, id`,
    )
    .all(userId) as Shift[];
  const days = new Set(shifts.map((s) => s.localDate));
  const notifier = { db: c.db, now: c.now, emit: c.emit };
  const tell = (kind: Parameters<typeof notify>[2], key: string) => {
    if (c.registry.isEnabled('notifications')) notify(notifier, userId, kind, key, kind);
  };

  // Earnings and labelled drop-offs: only from entered or labelled figures; none means unknown.
  const policy = createEarningsPolicy(c.db, c.registry, c.override);
  const rows = policy.any(userId)
    ? createEarningsRepository(c.db).effective(
        userId,
        '0000-01-01',
        '9999-12-31',
        policy.options(userId),
      )
    : [];
  const earnedCents = rows.length === 0 ? null : rows.reduce((a, r) => a + totalOf(r), 0);
  const labelled =
    c.registry.isEnabled('stops') && prefs.stopsEnabled === 1
      ? (c.db
          .prepare(
            "SELECT l.shift_id AS shiftId, s.local_date AS localDate FROM stop_labels l JOIN shifts s ON s.id = l.shift_id WHERE s.user_id = ? AND l.role = 'dropoff'",
          )
          .all(userId) as { shiftId: number; localDate: string }[])
      : [];

  // Longest run of consecutive shift days, ignoring freezes (a badge is about what was done).
  const sorted = [...days].sort();
  let best = 0;
  let run = 0;
  sorted.forEach((d, i) => {
    run = i > 0 && utc(d) - utc(sorted[i - 1]!) === DAY ? run + 1 : 1;
    best = Math.max(best, run);
  });

  // Challenges of the current week.
  const week = periodRange('weekly', today, prefs.weekStart);
  const inWeek = (d: string) => d >= week.from && d <= week.to;
  const weekRows = rows.filter((r) => inWeek(r.localDate));
  const challenges = [
    {
      id: 'earn',
      label: 'Earn this week',
      target: c.challengeTargetCents,
      value: weekRows.length === 0 ? null : weekRows.reduce((a, r) => a + totalOf(r), 0),
    },
    ...(labelled.length > 0
      ? [
          {
            id: 'deliveries',
            label: 'Label 20 drop-offs this week',
            target: 20,
            value: labelled.filter((l) => inWeek(l.localDate)).length as number | null,
          },
        ]
      : []),
    {
      id: 'streak5',
      label: 'Work 5 different days this week',
      target: 5,
      value: [...days].filter(inWeek).length as number | null,
    },
  ].map((ch) => ({ ...ch, done: ch.value !== null && ch.value >= ch.target }));

  const stats: Record<string, number | null> = {
    shifts: shifts.length,
    hours: shifts.reduce((a, s) => a + s.ms, 0) / 3_600_000,
    distance_km: shifts.reduce((a, s) => a + s.totalM, 0) / 1000,
    best_streak: best,
    earnings_cad_units: earnedCents === null ? null : earnedCents / 100,
    deliveries: labelled.length === 0 ? null : labelled.length,
    early_shift: shifts.some(
      (s) =>
        Number(
          new Intl.DateTimeFormat('en-GB', {
            timeZone: prefs.timezone,
            hour: '2-digit',
            hourCycle: 'h23',
          }).format(s.startedAt),
        ) < 6,
    )
      ? 1
      : 0,
  };

  // Record what became true.
  const unlock = c.db.prepare(
    'INSERT OR IGNORE INTO badge_unlocks (user_id, badge, unlocked_at, shift_id) VALUES (?, ?, ?, ?)',
  );
  const lastShift = shifts.at(-1)?.id ?? null;
  for (const bd of BADGES) {
    const v = stats[bd.metric];
    if (
      v !== null &&
      v !== undefined &&
      v >= bd.at &&
      unlock.run(userId, bd.slug, c.now(), lastShift).changes > 0
    )
      tell('badge', `badge:${bd.slug}`);
  }
  for (const ch of challenges) {
    if (ch.done && unlock.run(userId, `challenge:${ch.id}:${week.from}`, c.now(), null).changes > 0)
      tell('challenge', `challenge:${ch.id}:${week.from}`);
  }
  const unlocked = c.db
    .prepare('SELECT badge, unlocked_at AS at FROM badge_unlocks WHERE user_id = ?')
    .all(userId) as { badge: string; at: number }[];
  const badgeAt = new Map(
    unlocked.filter((u) => !u.badge.startsWith('challenge:')).map((u) => [u.badge, u.at]),
  );
  const challengesDone = unlocked.length - badgeAt.size;

  // XP and level (derived).
  let records = 0;
  let longest = 0;
  shifts.forEach((s, i) => {
    if (i > 0 && s.totalM > longest) records += 1;
    longest = Math.max(longest, s.totalM);
  });
  const xp =
    shifts.length * XP.shift +
    shifts.filter((s) => s.ms >= LONG_MS).length * XP.long +
    records * XP.record +
    badgeAt.size * XP.badge +
    challengesDone * XP.challenge;
  const level = Math.floor(xp / 100) + 1;

  // Freezes: a level-up grants one (at most 3 held); the streak uses one to bridge a missed day.
  c.db.prepare('INSERT OR IGNORE INTO progress_state (user_id) VALUES (?)').run(userId);
  const st = c.db
    .prepare(
      'SELECT freezes_held AS held, freezes_used_on AS used, levels_rewarded AS rewarded FROM progress_state WHERE user_id = ?',
    )
    .get(userId) as { held: number; used: string; rewarded: number };
  let held = st.held;
  const used = new Set(JSON.parse(st.used) as string[]);
  if (level - 1 > st.rewarded) {
    held = Math.min(3, held + (level - 1 - st.rewarded));
    tell('level_up', `level_up:${level}`);
  }
  let streak = 0;
  const first = sorted[0];
  let cur = days.has(today) ? today : iso(utc(today) - DAY);
  while (first !== undefined && cur >= first) {
    if (days.has(cur)) streak += 1;
    else if (used.has(cur)) {
      /* covered earlier */
    } else if (held > 0 && cur < today) {
      used.add(cur);
      held -= 1;
      tell('streak_freeze', `streak_freeze:${cur}`);
    } else break;
    cur = iso(utc(cur) - DAY);
  }
  const off = c.registry.isEnabled('schedule')
    ? c.db
        .prepare('SELECT 1 FROM schedule_off_days WHERE user_id = ? AND off_on = ?')
        .get(userId, today) !== undefined
    : false;
  const atRisk = streak > 0 && !days.has(today) && !off;
  if (atRisk) tell('streak_risk', `streak_risk:${today}`);
  c.db
    .prepare(
      'UPDATE progress_state SET freezes_held = ?, freezes_used_on = ?, levels_rewarded = ? WHERE user_id = ?',
    )
    .run(held, JSON.stringify([...used].sort()), Math.max(st.rewarded, level - 1), userId);

  return {
    xp,
    level,
    xp_into_level: xp % 100,
    xp_per_level: 100,
    streak: { days: streak, freezes_held: held, at_risk: atRisk },
    challenges: challenges.map((ch) => ({
      id: ch.id,
      label: ch.label,
      value: ch.value,
      target: ch.target,
      done: ch.done,
      week_start: week.from,
    })),
    badges: BADGES.map((bd) => ({
      slug: bd.slug,
      label: bd.label,
      unlocked_at: badgeAt.get(bd.slug) ?? null,
    })),
  };
}
