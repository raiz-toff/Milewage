import { resolveModuleConfig } from '@milewage/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { serverModules } from '../src/index';
import { harness, type Harness } from './support';

// 18 section 8.2: progress, off by default. The clock is Friday 2027-01-15, 02:00 in Chicago.
let h: Harness;
let cookie: string;
afterEach(async () => {
  await h?.close();
  h = undefined as never;
});

const send = (method: string, url: string, payload?: object) =>
  h.call(method, url, payload, { cookie });
let n = 0;

async function setup(
  extra: Parameters<typeof harness>[1] = {},
  enabled: Record<string, boolean> = {},
) {
  h = harness({ progress: true, ...enabled }, extra);
  ({ cookie } = await h.signUp());
  await send('POST', '/vehicles', { name: 'Civic', kind: 'car' });
}
/** An ended shift on a local date, `hours` long and `km` long. */
async function shift(date: string, hours: number, km: number) {
  n += 1;
  const id = (
    await send('POST', '/shifts', {
      client_id: `0b1c8a52-8f0d-4c52-9d5b-5c8a0f3d1e${String(n).padStart(2, '0')}`,
      vehicle_id: 1,
      started_at: h.clock.t,
    })
  ).json().id as number;
  h.db
    .prepare(
      "UPDATE shifts SET status = 'ended', ended_at = started_at + ?, local_date = ?, total_m = ? WHERE id = ?",
    )
    .run(hours * 3_600_000, date, km * 1000, id);
  return id;
}
const progress = async () => (await send('GET', '/progress')).json();

describe('defaults', () => {
  test('off unless switched on, by file or environment', () => {
    const m = serverModules.find((x) => x.name === 'progress')!;
    expect([m.defaultEnabled, [...m.dependsOn]]).toEqual([false, ['goals', 'earnings']]);
    expect(resolveModuleConfig(serverModules, {}, {}).progress).toBe(false);
    expect(resolveModuleConfig(serverModules, {}, { MILEWAGE_MODULE_PROGRESS: '1' }).progress).toBe(
      true,
    );
  });
});

describe('XP, level, badges, streak', () => {
  test('nothing recorded: level 1, every badge locked, unknown is null', async () => {
    await setup();
    const p = await progress();
    expect(p).toMatchObject({
      xp: 0,
      level: 1,
      xp_into_level: 0,
      streak: { days: 0, freezes_held: 0, at_risk: false },
    });
    expect(p.badges).toHaveLength(24);
    expect(p.badges.every((b: { unlocked_at: number | null }) => b.unlocked_at === null)).toBe(
      true,
    );
    expect(p.challenges.map((c: { id: string; value: number | null }) => [c.id, c.value])).toEqual([
      ['earn', null],
      ['streak5', 0],
    ]);
  });

  test('three growing shifts: XP by the table, badges, a level-up that grants freezes, a streak at risk', async () => {
    await setup();
    await shift('2027-01-12', 5, 100);
    await shift('2027-01-13', 5, 150);
    await shift('2027-01-14', 5, 200);
    const p = await progress();
    // 3 x 10 + 3 x 15 (4 h or more) + 2 x 30 (longer than any before) + 5 badges x 40
    expect(p.xp).toBe(30 + 45 + 60 + 200);
    expect(p).toMatchObject({
      level: 4,
      xp_into_level: 35,
      streak: { days: 3, freezes_held: 3, at_risk: true },
    });
    const unlocked = p.badges
      .filter((b: { unlocked_at: number | null }) => b.unlocked_at !== null)
      .map((b: { slug: string }) => b.slug);
    expect(unlocked.sort()).toEqual([
      'distance_100',
      'early_bird',
      'first_shift',
      'hours_10',
      'streak_3',
    ]);
    // earnings badges and the earnings challenge stay locked while nothing is entered
    expect(p.badges.find((b: { slug: string }) => b.slug === 'earned_100').unlocked_at).toBeNull();
  });

  test('evaluating again records nothing new', async () => {
    await setup();
    await shift('2027-01-14', 5, 100);
    const a = await progress();
    h.clock.t += 60_000;
    const b = await progress();
    expect(b).toEqual(a);
    expect(h.db.prepare('SELECT count(*) FROM badge_unlocks').pluck().get()).toBeGreaterThan(0);
  });

  test('a typed total unlocks the earnings badge and counts for the earn challenge; the target is a setting', async () => {
    await setup({ comma: { challengeTargetCents: 10_000 } });
    const id = await shift('2027-01-14', 2, 10);
    await send('PUT', `/shifts/${id}/earnings/doordash`, { gross_cents: 20_000 });
    const p = await progress();
    expect(
      p.badges.find((b: { slug: string }) => b.slug === 'earned_100').unlocked_at,
    ).not.toBeNull();
    expect(p.challenges.find((c: { id: string }) => c.id === 'earn')).toMatchObject({
      value: 20_000,
      target: 10_000,
      done: true,
      week_start: '2027-01-11',
    });
    // a completed challenge is worth 60 and is not shown as a badge
    expect(p.badges).toHaveLength(24);
    expect(
      h.db
        .prepare("SELECT count(*) FROM badge_unlocks WHERE badge LIKE 'challenge:%'")
        .pluck()
        .get(),
    ).toBe(1);
  });

  test('a freeze bridges one missed day once; the dates it covered are remembered', async () => {
    await setup();
    for (const d of ['2027-01-10', '2027-01-12', '2027-01-13', '2027-01-14']) await shift(d, 1, 1);
    h.db
      .prepare(
        'INSERT INTO progress_state (user_id, freezes_held, levels_rewarded) VALUES (1, 2, 99)',
      )
      .run();
    const first = await progress();
    expect(first.streak).toMatchObject({ days: 4, freezes_held: 1 }); // 14, 13, 12, [11 frozen], 10
    expect(
      JSON.parse(
        h.db.prepare('SELECT freezes_used_on FROM progress_state').pluck().get() as string,
      ),
    ).toEqual(['2027-01-11']);
    expect((await progress()).streak).toMatchObject({ days: 4, freezes_held: 1 }); // not used again
  });

  test('without a freeze the streak stops at the gap; the labelled-drop-offs challenge only exists once something is labelled', async () => {
    await setup();
    for (const d of ['2027-01-10', '2027-01-12', '2027-01-14']) await shift(d, 1, 1);
    h.db
      .prepare(
        'INSERT INTO progress_state (user_id, freezes_held, levels_rewarded) VALUES (1, 0, 99)',
      )
      .run();
    expect((await progress()).streak.days).toBe(1);
    expect((await progress()).challenges.map((c: { id: string }) => c.id)).not.toContain(
      'deliveries',
    );
    h.db
      .prepare(
        "INSERT INTO stops (user_id, shift_id, stop_key, started_at, ended_at, dwell_s, lat_e7, lon_e7, confidence, est_role, role) VALUES (1, 1, 'k', 1, 2, 60, 0, 0, 'high', 'dropoff', 'none')",
      )
      .run();
    h.db
      .prepare(
        "INSERT INTO stop_labels (user_id, shift_id, stop_key, role, edited_at) VALUES (1, 1, 'k', 'dropoff', 1)",
      )
      .run();
    expect(
      (await progress()).challenges.find((c: { id: string }) => c.id === 'deliveries'),
    ).toMatchObject({ target: 20, value: 0 });
  });
});

describe('notifications and modules', () => {
  test('unlocks, level-ups and freezes reach the inbox when that module is on', async () => {
    await setup();
    await shift('2027-01-14', 5, 100);
    await progress();
    const kinds = (await send('GET', '/notifications'))
      .json()
      .items.map((i: { kind: string }) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(['badge', 'streak_risk']));
  });

  test('without goals the module cannot start; with it off the route is 404', async () => {
    expect(() => harness({ progress: true, goals: false })).toThrow(/depends on "goals"/);
    h = harness({ progress: false });
    ({ cookie } = await h.signUp());
    expect((await send('GET', '/progress')).statusCode).toBe(404);
    expect((await send('GET', '/settings')).json().modules.progress).toBe(false);
  });
});
