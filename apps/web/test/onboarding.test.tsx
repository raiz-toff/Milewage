// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Schemas, Settings } from '../src/api/client';
import { pick, renderApp, settingsFixture, signedIn } from './support/kit';
import type { Handler } from './support/kit';
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

type Platform = Schemas['Platform'];
const app = (slug: string, label: string): Platform => ({
  slug,
  label,
  custom: false,
  color: null,
  emoji: null,
  active: true,
  sort: 0,
  hourly_target_cents: null,
});

function wizard(
  over: Partial<Settings> = {},
  url = '/',
  countries = countriesFixture(),
  vehicles: { name: string; archived_at: null }[] = [],
  extra: Record<string, Handler> = {},
) {
  let current = settingsFixture({ onboarded_at: null, ...over });
  let platforms = [app('uber_eats', 'Uber Eats'), app('doordash', 'DoorDash')];
  const put =
    (slug: string): Handler =>
    ({ body }) => {
      const b = body as Partial<Platform>;
      const found = platforms.find((p) => p.slug === slug);
      if (found) Object.assign(found, b);
      else platforms = [...platforms, { ...app(slug, b.label!), custom: true }];
      return { body: {} };
    };
  return renderApp(
    {
      ...signedIn(current),
      'GET /settings': () => ({ body: current }),
      'GET /countries': () => ({ body: countries }),
      'GET /platforms': () => ({ body: platforms }),
      'PUT /platforms/doordash': put('doordash'),
      'PUT /platforms/uber_eats': put('uber_eats'),
      'PUT /platforms/fantuan': put('fantuan'),
      'GET /vehicles': () => ({ body: vehicles }),
      'POST /vehicles': ({ body }) => {
        vehicles = [...vehicles, { ...(body as { name: string }), archived_at: null }];
        return { status: 201, body: {} };
      },
      ...extra,
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
    // One kind of work in Canada: that step is not shown (region, apps, vehicle, goal, phone).
    expect(await heading('Where you drive — Step 1 of 5')).toBeTruthy();
    expect(document.title).toBe('Where you drive — Step 1 of 5 — MileWage');
    expect(
      screen.getByText(/Until you choose your province, only the national rules/),
    ).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Back' })).toBeNull();
    pick('Province', 'ON');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // The answer is saved on Continue, then the next step opens.
    expect(await heading('Your apps — Step 2 of 5')).toBeTruthy();
    expect(patches(calls)).toEqual([{ region: 'ON' }]);
  });

  it('asks the work kinds where there are several; back and skip keep answers', async () => {
    const { calls } = wizard({ country: 'YY', work_kinds: [] }, '/', twoKinds());
    expect(await heading(/Where you drive — Step 1 of \d/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Skip this step' }));
    expect(await heading(/What work you do — Step 2 of \d/)).toBeTruthy();
    expect(patches(calls)).toEqual([]);

    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    expect(await heading(/Where you drive — Step 1 of \d/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Skip this step' }));
    await heading(/What work you do/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Motorcycle taxi' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Delivery/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // Kept in the country's order, whatever the order of the clicks.
    await heading(/Your apps/);
    expect(patches(calls)).toEqual([{ work_kinds: ['delivery', 'moto_taxi'] }]);
  });

  it('resumes at the first step not done, read from the server', async () => {
    wizard({ country: 'YY', region: 'NO', work_kinds: [] }, '/dashboard', twoKinds());
    expect(await heading(/What work you do — Step 2 of \d/)).toBeTruthy();
  });

  it('an onboarded driver gets the app; the wizard still opens at its address', async () => {
    renderApp({ ...signedIn() }, '/dashboard');
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Step \d of/ })).toBeNull();
    cleanup();
    renderApp({ ...signedIn() }, '/onboarding/region');
    expect(await heading(/Where you drive — Step 1 of \d/)).toBeTruthy();
  });

  it('apps: nothing ticked at first; the ones not ticked are switched off, another app added', async () => {
    const { calls } = wizard({ region: 'ON' }, '/onboarding/apps');
    expect(await heading(/Your apps — Step 2 of \d/)).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Uber Eats' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Uber Eats' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Another app' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Enter the name of the other app.',
    );
    fireEvent.change(screen.getByLabelText('Name of the app'), { target: { value: 'Fantuan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await heading(/Your vehicle/)).toBeTruthy();
    expect(calls.filter((c) => c.method === 'PUT').map((c) => [c.path, c.body])).toEqual([
      ['/platforms/doordash', { active: false }],
      ['/platforms/fantuan', { label: 'Fantuan' }],
    ]);
  });

  it('vehicle: needed when there is none; says which rate applies; sends ownership', async () => {
    const { calls } = wizard({ region: 'ON' }, '/onboarding/vehicle');
    expect(await heading(/Your vehicle — Step 3 of \d/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Skip this step' })).toBeNull();
    expect(screen.getByRole('note').textContent).toBe('Gets the official mileage rate of Canada.');
    pick('Type', 'bicycle');
    expect(screen.getByRole('note').textContent).toMatch(/^Bicycles, .* have no mileage rate\.$/);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a name for your vehicle.');
    pick('Type', 'car');
    pick('Ownership', 'rented');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Civic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        name: 'Civic',
        kind: 'car',
        ownership: 'rented',
      }),
    );
  });

  it('vehicle: where there is no official rate, the own rate can be set; skip once one exists', async () => {
    const zz = { ...countriesFixture()[1]!, code: 'ZZ', supports: { mileage: false, tax: false } };
    const { calls } = wizard(
      { country: 'ZZ', currency: 'NPR' },
      '/onboarding/vehicle',
      [zz],
      [{ name: 'Old van', archived_at: null }],
    );
    await heading(/Your vehicle/);
    expect(screen.getByText(/Your vehicles: Old van\./)).toBeTruthy();
    expect(screen.getByRole('note').textContent).toBe(
      'No official rate here: you can set your own rate.',
    );
    fireEvent.change(screen.getByLabelText('Your mileage rate (NPR per km)'), {
      target: { value: '0.305' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(patches(calls)[0]).toEqual({ own_mileage_rate: { cents_per_unit: 30.5, unit: 'km' } }),
    );
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('weekly goal: an amount becomes a weekly earnings goal; empty is a skip', async () => {
    const { calls } = wizard({ region: 'ON' }, '/onboarding/goal', undefined, [], {
      'POST /goals': () => ({ status: 201, body: {} }),
    });
    expect(await heading('Weekly goal — Step 4 of 5')).toBeTruthy();
    const field = screen.getByLabelText('How much do you want to earn each week? (CAD)');
    fireEvent.change(field, { target: { value: 'lots' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/^Enter an amount above 0/);
    fireEvent.change(field, { target: { value: '800' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await heading(/Pair your phone/)).toBeTruthy();
    expect(calls.find((c) => c.path === '/goals' && c.method === 'POST')?.body).toEqual({
      label: 'Weekly earnings',
      metric: 'earnings',
      period: 'weekly',
      target: 80_000,
    });
  });

  it('pair your phone: shows the pairing code and waits for the phone to appear', async () => {
    let asked = 0;
    const phone = { id: 1, name: 'Pixel 8', platform: 'android', created_at: 1 };
    const { calls } = wizard({ region: 'ON' }, '/onboarding/phone', undefined, [], {
      'POST /pairing-tokens': () => ({
        status: 201,
        body: { token: 'mwp_x', qr_payload: 'milewage://pair?t=mwp_x', expires_at: 2e12 },
      }),
      // The wizard reads the list once; the step's first check finds the phone.
      'GET /devices': () => ({
        body: ++asked > 1 ? [{ ...phone, last_seen_at: 2, revoked_at: null }] : [],
      }),
    });
    expect(await heading('Pair your phone — Step 5 of 5')).toBeTruthy();
    expect(await screen.findByRole('img', { name: 'Pairing code' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pair later' })).toBeTruthy();
    expect(await screen.findByText('Paired: Pixel 8.', {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pair later' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(patches(calls)).toEqual([{ onboarded: true }]));
  });
});
