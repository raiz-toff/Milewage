// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp, settingsFixture, signedIn, DASHBOARD } from './support/kit';

afterEach(cleanup);

const progress = {
  xp: 335,
  level: 4,
  xp_into_level: 35,
  xp_per_level: 100,
  streak: { days: 3, freezes_held: 1, at_risk: true },
  challenges: [
    {
      id: 'earn',
      label: 'Earn this week',
      value: null,
      target: 50_000,
      done: false,
      week_start: '2027-01-11',
    },
    {
      id: 'streak5',
      label: 'Work 5 different days this week',
      value: 5,
      target: 5,
      done: true,
      week_start: '2027-01-11',
    },
  ],
  badges: [
    { slug: 'first_shift', label: 'First shift', unlocked_at: 1_700_000_000_000 },
    { slug: 'earned_100', label: '100 earned', unlocked_at: null },
  ],
};

function open(enabled = true) {
  return renderApp(
    {
      ...signedIn(settingsFixture({ modules: { progress: enabled } })),
      'GET /progress': () => ({ body: progress }),
    },
    '/progress',
  );
}

describe('progress screen (module progress)', () => {
  it('shows level, streak with its risk, challenges that say when nothing is entered, and locked badges', async () => {
    open();
    expect(await screen.findByText('Level 4')).toBeTruthy();
    expect(
      screen.getByRole('progressbar', { name: 'XP to next level' }).getAttribute('aria-valuenow'),
    ).toBe('35');
    expect(screen.getByText('335 XP in total, 65 to the next level.')).toBeTruthy();
    expect(screen.getByText('3 days in a row, 1 freeze held.')).toBeTruthy();
    expect(screen.getByText(/No shift yet today/)).toBeTruthy();
    expect(screen.getByText('nothing entered yet')).toBeTruthy();
    expect(screen.getByText('done')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Badges' }).textContent).toMatch(
      /First shift.*2023.*100 earned.*locked/,
    );
  });

  it('is absent when the module is off (the default)', async () => {
    const s = open(false);
    expect(await screen.findByRole('heading', { name: DASHBOARD })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Progress' })).toBeNull();
    expect(s.calls.some((c) => c.path === '/progress')).toBe(false);
  });
});
