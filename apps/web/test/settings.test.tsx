// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { changes } from '../src/pages/SettingsPage';
import { renderApp, settingsFixture, signedIn, pick, optionsOf } from './support/kit';
import type { Handler } from './support/kit';
import { countriesFixture } from './support/fixtures';

afterEach(cleanup);

function server(initial = settingsFixture(), patch?: Handler, url = '/settings') {
  let current = initial;
  return renderApp(
    {
      ...signedIn(),
      'GET /settings': () => ({ body: current }),
      'PATCH /settings':
        patch ??
        (({ body }) => {
          const b = body as Record<string, unknown>;
          current = {
            ...current,
            ...b,
            diagnostics: b.diagnostics_level
              ? { ...current.diagnostics, level: b.diagnostics_level as 'off' }
              : current.diagnostics,
            modules: {
              ...current.modules,
              stops: b.stops_enabled === undefined ? current.modules.stops : !!b.stops_enabled,
            },
          } as typeof current;
          return { body: current };
        }),
    },
    url,
  );
}

/** Opens a settings page from the section list, as a click would. */
const go = async (label: string) =>
  fireEvent.click(
    within(await screen.findByRole('navigation', { name: 'Settings sections' })).getByRole('link', {
      name: label,
    }),
  );

const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

/** The On/Off badge next to a module name in the Modules card. */
const flag = (name: string) =>
  within(screen.getByRole('region', { name: 'Modules' })).getByText(name).nextElementSibling
    ?.textContent;

describe('settings page', () => {
  it('shows the saved values and keeps Save disabled until something changes', async () => {
    server();
    expect(((await screen.findByLabelText('Name')) as HTMLInputElement).value).toBe('');
    await go('Units and format');
    expect(((await screen.findByLabelText('Currency')) as HTMLInputElement).value).toBe('CAD');
    await go('Tracking and privacy');
    expect(
      ((await screen.findByLabelText('Keep raw GPS points (days)')) as HTMLInputElement).value,
    ).toBe('90');
    expect(save().disabled).toBe(true);
  });

  it('sends only the changed fields and shows what the server returned', async () => {
    const { calls } = server(settingsFixture(), undefined, '/settings/units');
    pick(await screen.findByLabelText('Distance unit'), 'mi');
    // An unsaved edit survives moving to another settings page and is saved from there.
    await go('Tracking and privacy');
    fireEvent.change(await screen.findByLabelText('Keep raw GPS points (days)'), {
      target: { value: '120' },
    });
    fireEvent.click(save());
    expect((await screen.findByRole('status')).textContent).toBe('Saved.');
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      distance_unit: 'mi',
      raw_retention_days: 120,
    });
    expect(save().disabled).toBe(true);
  });

  it('turns stops off and reads the effective flag back', async () => {
    const { calls } = server(settingsFixture(), undefined, '/settings/tracking');
    const toggle = await screen.findByRole('switch', { name: /Detect stops/ });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    fireEvent.click(save());
    await screen.findByRole('status');
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ stops_enabled: false });
    await go('Server modules');
    await screen.findByRole('region', { name: 'Modules' });
    expect(flag('stops')).toBe('Off');
  });

  it('shows the server validation error and keeps the draft', async () => {
    server(
      settingsFixture(),
      () => ({
        status: 422,
        body: {
          code: 'validation_failed',
          errors: [{ path: '/timezone', message: 'must be an IANA time zone name' }],
        },
      }),
      '/settings/units',
    );
    fireEvent.change(await screen.findByLabelText(/Time zone/), { target: { value: 'Mars/Base' } });
    fireEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toBe(
      '/timezone: must be an IANA time zone name',
    );
    expect((screen.getByLabelText(/Time zone/) as HTMLInputElement).value).toBe('Mars/Base');
  });

  it('offers only the countries the server lists and shows the module flags', async () => {
    server(settingsFixture({ modules: { countries: ['CA', 'GB'], diagnostics: false } }));
    expect(optionsOf(await screen.findByLabelText('Country'))).toEqual(['CA', 'GB']);
    await go('Server modules');
    await screen.findByRole('region', { name: 'Modules' });
    expect(flag('diagnostics')).toBe('Off');
    expect(flag('sync')).toBe('On');
    const mods = screen.getByRole('region', { name: 'Modules' });
    expect(within(mods).getByText('csv')).toBeTruthy();
  });

  it('names countries, offers the regions in a drop-down and prompts for a region with its own rules', async () => {
    const { calls } = server();
    const country = await screen.findByLabelText('Country');
    await waitFor(() => expect(country.textContent).toBe('Canada'));
    const prompt =
      'Set your province to include its own rules. Until then, only the national rules apply.';
    expect(screen.getByRole('note').textContent).toBe(prompt);
    expect(optionsOf('Province')).toEqual(['', 'AB', 'ON', 'QC']);
    pick('Province', 'QC');
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(save());
    await screen.findByRole('status');
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ region: 'QC' });

    // A new country starts without a region; one without regional rules gets no prompt.
    pick('Country', 'US');
    expect((screen.getByLabelText('State') as HTMLElement).textContent).toBe('Not set');
    expect(screen.queryByRole('note')).toBeNull();
    pick('Country', 'GB');
    expect(screen.getByLabelText('Nation')).toBeTruthy();
  });

  it('mileage rate: says which rate is in use, switches, and adds, edits and removes your rates', async () => {
    let use = false;
    let rates = [{ id: 1, effective_from: null, cents_per_unit: 50, unit: 'km', note: null }] as {
      id: number;
      effective_from: string | null;
      cents_per_unit: number;
      unit: string;
      note: string | null;
    }[];
    const { calls } = renderApp(
      {
        ...signedIn(settingsFixture()),
        'GET /settings': () => ({ body: settingsFixture({ use_own_mileage_rate: use }) }),
        'PATCH /settings': ({ body }) => {
          use = (body as { use_own_mileage_rate: boolean }).use_own_mileage_rate;
          return { body: settingsFixture({ use_own_mileage_rate: use }) };
        },
        'GET /own-mileage-rates': () => ({ body: rates }),
        'POST /own-mileage-rates': ({ body }) => {
          const r = {
            id: rates.length + 1,
            note: null,
            ...(body as object),
          } as (typeof rates)[number];
          rates = [...rates, r];
          return { status: 201, body: r };
        },
        'PATCH /own-mileage-rates/1': ({ body }) => {
          rates = [{ ...rates[0]!, ...(body as object) }, ...rates.slice(1)];
          return { body: rates[0] };
        },
        'DELETE /own-mileage-rates/1': () => {
          rates = rates.slice(1);
          return { status: 204 };
        },
      },
      '/settings/rate',
    );
    const status = await screen.findByRole('status');
    await waitFor(() =>
      expect(status.textContent).toBe('In use today: the country rate for Canada.'),
    );
    expect(await screen.findByText('$0.50 per km')).toBeTruthy();
    expect(screen.getByText('From the start')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Your rate' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH' && c.path === '/settings')?.body).toEqual({
        use_own_mileage_rate: true,
      }),
    );

    // A new rate needs an amount; the day defaults to today.
    fireEvent.click(screen.getByRole('button', { name: 'Add rate' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Enter your rate in CAD per km/);
    fireEvent.change(screen.getByLabelText('Rate (CAD per km)'), { target: { value: '0.725' } });
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'Employer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rate' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
        cents_per_unit: 72.5,
        unit: 'km',
        note: 'Employer',
        effective_from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
    expect(await screen.findByText('$0.725 per km')).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      threshold_units: null,
      cents_per_unit_after: null,
    });

    // A rate in two steps (ADR 0012): the first rate up to a distance, then another.
    fireEvent.change(screen.getByLabelText('Rate (CAD per km)'), { target: { value: '0.70' } });
    fireEvent.click(screen.getByLabelText('A different rate after a set distance'));
    fireEvent.click(screen.getByRole('button', { name: 'Add rate' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/in whole km/);
    fireEvent.change(screen.getByLabelText('First rate covers (km a year)'), {
      target: { value: '5000' },
    });
    fireEvent.change(screen.getByLabelText('Rate after that (CAD per km)'), {
      target: { value: '0.64' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add rate' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'POST').at(-1)?.body).toMatchObject({
        cents_per_unit: 70,
        threshold_units: 5000,
        cents_per_unit_after: 64,
      }),
    );
    expect(await screen.findByText('$0.70 per km for the first 5,000 km, then $0.64')).toBeTruthy();

    // Edit keeps the undated rate's "from the start" unless a day is chosen.
    fireEvent.pointerDown(screen.getByRole('button', { name: /Actions for \$0\.50 per km/ }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Rate (CAD per km)'), { target: { value: '0.55' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH' && c.path.endsWith('/1'))?.body).toEqual({
        effective_from: null,
        cents_per_unit: 55,
        unit: 'km',
        note: null,
        threshold_units: null,
        cents_per_unit_after: null,
      }),
    );
    fireEvent.pointerDown(
      await screen.findByRole('button', { name: /Actions for \$0\.55 per km/ }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });

  it('mileage rate: without a country rate there is no switch, and it says so', async () => {
    const np = { ...countriesFixture()[0]!, code: 'NP', name: 'Nepal', regions: [] };
    renderApp(
      {
        ...signedIn(settingsFixture({ country: 'NP', currency: 'NPR', mileage_rate: 'none' })),
        'GET /countries': () => ({
          body: [...countriesFixture(), { ...np, supports: { mileage: false, tax: false } }],
        }),
        'GET /own-mileage-rates': () => ({ body: [] }),
      },
      '/settings/rate',
    );
    const status = await screen.findByRole('status');
    await waitFor(() =>
      expect(status.textContent).toMatch(/No rate in use: MileWage has no country rate for Nepal/),
    );
    await screen.findByText(/No rates of your own/);
    expect(screen.queryByRole('group', { name: 'Rate for your mileage deduction' })).toBeNull();
  });

  it('hides the diagnostics level when the diagnostics module is off', async () => {
    server(settingsFixture({ modules: { diagnostics: false } }), undefined, '/settings/tracking');
    await screen.findByLabelText('Keep raw GPS points (days)');
    expect(screen.queryByLabelText('Diagnostics level')).toBeNull();
  });

  it('changes() lists nothing for an untouched draft and converts the retention number', () => {
    const s = settingsFixture();
    const same = {
      country: 'CA',
      distance_unit: 'km' as const,
      currency: 'CAD',
      timezone: 'America/Toronto',
      raw_retention_days: '90',
      stops_enabled: true,
      help_enabled: true,
      diagnostics_level: 'basic' as const,
      display_name: '',
      region: '',
      week_start: '1' as const,
      time_format: '24h' as const,
    };
    expect(changes(s, same)).toEqual({});
    expect(changes(s, { ...same, raw_retention_days: '30' })).toEqual({ raw_retention_days: 30 });
  });

  it('saves the profile fields: empty name and region become null, week start a number', async () => {
    const { calls } = server();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Sam' } });
    pick(await screen.findByLabelText('Province'), 'ON');
    await go('Units and format');
    pick(await screen.findByLabelText('Week starts on'), '0');
    pick(screen.getByLabelText('Time format'), '12h');
    fireEvent.click(save());
    await screen.findByRole('status');
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      display_name: 'Sam',
      region: 'ON',
      week_start: 0,
      time_format: '12h',
    });
    await go('Profile and region');
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: '' } });
    fireEvent.click(save());
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2));
    expect(calls.filter((c) => c.method === 'PATCH')[1]?.body).toEqual({ display_name: null });
  });

  it('upper-cases the currency while typing and saves it', async () => {
    server(settingsFixture(), undefined, '/settings/units');
    fireEvent.change(await screen.findByLabelText('Currency'), { target: { value: 'usd' } });
    expect((screen.getByLabelText('Currency') as HTMLInputElement).value).toBe('USD');
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  });
});
