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
    server(settingsFixture({ modules: { countries: ['CA', 'GB'], replay: false } }));
    expect(optionsOf(await screen.findByLabelText('Country'))).toEqual(['CA', 'GB']);
    await go('Server modules');
    await screen.findByRole('region', { name: 'Modules' });
    expect(flag('replay')).toBe('Off');
    expect(flag('sync')).toBe('On');
    const mods = screen.getByRole('region', { name: 'Modules' });
    expect(['csv', 'gpx', 'geojson'].every((f) => within(mods).getByText(f))).toBe(true);
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

  it('offers your own mileage rate only where the country has no official rate', async () => {
    const np = { ...countriesFixture()[0]!, code: 'NP', name: 'Nepal', regions: [] };
    const { calls } = renderApp(
      {
        ...signedIn(settingsFixture({ country: 'NP', currency: 'NPR' })),
        'GET /countries': () => ({
          body: [...countriesFixture(), { ...np, supports: { mileage: false, tax: false } }],
        }),
        'PATCH /settings': ({ body }) => ({ body: settingsFixture(body as object) }),
      },
      '/settings',
    );
    const rate = await screen.findByLabelText('Your mileage rate (NPR per km)');
    fireEvent.change(rate, { target: { value: '12.305' } });
    fireEvent.click(save());
    await screen.findByRole('status');
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      own_mileage_rate: { cents_per_unit: 1230.5, unit: 'km' },
    });
    pick('Country', 'CA');
    expect(screen.queryByLabelText(/Your mileage rate/)).toBeNull();
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
      diagnostics_level: 'basic' as const,
      display_name: '',
      region: '',
      week_start: '1' as const,
      time_format: '24h' as const,
      own_rate: '',
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
