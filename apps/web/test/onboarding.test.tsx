// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Settings } from '../src/api/client';
import { pick, renderApp, settingsFixture, signedIn } from './support/kit';
import { countriesFixture } from './support/fixtures';

afterEach(cleanup);

// A country whose data covers two kinds of work, so the wizard asks (plan 23 rule 1).
const twoKinds = () => [
  ...countriesFixture(),
  {
    ...countriesFixture()[0]!,
    code: 'YY',
    name: 'Testland',
    work: ['delivery' as const, 'moto_taxi' as const],
    labels: { region: 'state', city: null },
    regions: [{ code: 'NO', name: 'North', own_rules: false, verified: false, cities: [] }],
  },
];

function wizard(over: Partial<Settings> = {}, url = '/', countries = countriesFixture()) {
  let current = settingsFixture({ onboarded_at: null, ...over });
  return renderApp(
    {
      ...signedIn(current),
      'GET /settings': () => ({ body: current }),
      'GET /countries': () => ({ body: countries }),
      'PATCH /settings': ({ body }) => {
        const b = body as Record<string, unknown> & { onboarded?: boolean };
        const { onboarded, ...rest } = b;
        current = { ...current, ...rest } as Settings;
        if (onboarded !== undefined) current.onboarded_at = onboarded ? 5 : null;
        return { body: current };
      },
    },
    url,
  );
}

const heading = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name });
const patches = (calls: { method: string; path: string; body: unknown }[]) =>
  calls.filter((c) => c.method === 'PATCH' && c.path === '/settings').map((c) => c.body);

describe('onboarding wizard (plan 23)', () => {
  it('opens for a driver not yet onboarded; Canada asks only the province', async () => {
    const { calls } = wizard();
    // One kind of work in Canada: that step is not shown, so the count is 1.
    expect(await heading('Where you drive — Step 1 of 1')).toBeTruthy();
    expect(document.title).toBe('Where you drive — Step 1 of 1 — MileWage');
    expect(
      screen.getByText(/Until you choose your province, only the national rules/),
    ).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Back' })).toBeNull();
    pick('Province', 'ON');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // The answer is saved on Continue; the last step finishes and opens the dashboard.
    await waitFor(() => expect(patches(calls)).toEqual([{ region: 'ON' }, { onboarded: true }]));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Step/ })).toBeNull());
  });

  it('asks the work kinds where there are several; back and skip keep answers', async () => {
    const { calls } = wizard({ country: 'YY', work_kinds: [] }, '/', twoKinds());
    expect(await heading('Where you drive — Step 1 of 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Skip this step' }));
    expect(await heading('What work you do — Step 2 of 2')).toBeTruthy();
    expect(patches(calls)).toEqual([]);

    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    expect(await heading('Where you drive — Step 1 of 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Skip this step' }));
    await heading(/What work you do/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Motorcycle taxi' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Delivery/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // Kept in the country's order, whatever the order of the clicks.
    await waitFor(() =>
      expect(patches(calls)).toEqual([
        { work_kinds: ['delivery', 'moto_taxi'] },
        { onboarded: true },
      ]),
    );
  });

  it('resumes at the first step not done, read from the server', async () => {
    wizard({ country: 'YY', region: 'NO', work_kinds: [] }, '/dashboard', twoKinds());
    expect(await heading('What work you do — Step 2 of 2')).toBeTruthy();
  });

  it('an onboarded driver gets the app; the wizard still opens at its address', async () => {
    renderApp({ ...signedIn() }, '/dashboard');
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Step \d of/ })).toBeNull();
    cleanup();
    renderApp({ ...signedIn() }, '/onboarding/region');
    expect(await heading('Where you drive — Step 1 of 1')).toBeTruthy();
  });
});
