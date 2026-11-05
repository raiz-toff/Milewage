// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { changes } from '../src/pages/SettingsPage';
import { renderApp, settingsFixture, signedIn } from './support/kit';
import type { Handler } from './support/kit';

afterEach(cleanup);

function server(initial = settingsFixture(), patch?: Handler) {
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
    '/settings',
  );
}

const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

describe('settings page', () => {
  it('shows the saved values and keeps Save disabled until something changes', async () => {
    server();
    expect(((await screen.findByLabelText('Currency')) as HTMLInputElement).value).toBe('CAD');
    expect((screen.getByLabelText('Keep raw GPS points (days)') as HTMLInputElement).value).toBe(
      '90',
    );
    expect(save().disabled).toBe(true);
  });

  it('sends only the changed fields and shows what the server returned', async () => {
    const { calls } = server();
    fireEvent.change(await screen.findByLabelText('Distance unit'), { target: { value: 'mi' } });
    fireEvent.change(screen.getByLabelText('Keep raw GPS points (days)'), {
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
    const { calls } = server();
    const box = (await screen.findByLabelText(/Detect stops/)) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    fireEvent.click(save());
    await screen.findByRole('status');
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ stops_enabled: false });
    expect(screen.getByText('stops: off')).toBeTruthy();
  });

  it('shows the server validation error and keeps the draft', async () => {
    server(settingsFixture(), () => ({
      status: 422,
      body: {
        code: 'validation_failed',
        errors: [{ path: '/timezone', message: 'must be an IANA time zone name' }],
      },
    }));
    fireEvent.change(await screen.findByLabelText(/Time zone/), { target: { value: 'Mars/Base' } });
    fireEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toBe(
      '/timezone: must be an IANA time zone name',
    );
    expect((screen.getByLabelText(/Time zone/) as HTMLInputElement).value).toBe('Mars/Base');
  });

  it('offers only the countries the server lists and shows the module flags', async () => {
    server(settingsFixture({ modules: { countries: ['CA', 'GB'], live: false } }));
    const country = (await screen.findByLabelText('Country')) as HTMLSelectElement;
    expect([...country.options].map((o) => o.value)).toEqual(['CA', 'GB']);
    const mods = screen.getByRole('region', { name: 'Modules' });
    expect(within(mods).getByText('live: off')).toBeTruthy();
    expect(within(mods).getByText('Exporters: csv, gpx, geojson')).toBeTruthy();
  });

  it('hides the diagnostics level when the diagnostics module is off', async () => {
    server(settingsFixture({ modules: { diagnostics: false } }));
    await screen.findByLabelText('Currency');
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
    };
    expect(changes(s, same)).toEqual({});
    expect(changes(s, { ...same, raw_retention_days: '30' })).toEqual({ raw_retention_days: 30 });
  });

  it('saves the profile fields: empty name and region become null, week start a number', async () => {
    const { calls } = server();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/^Region/), { target: { value: 'on' } });
    fireEvent.change(screen.getByLabelText('Week starts on'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Time format'), { target: { value: '12h' } });
    fireEvent.click(save());
    await screen.findByRole('status');
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      display_name: 'Sam',
      region: 'ON',
      week_start: 0,
      time_format: '12h',
    });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '' } });
    fireEvent.click(save());
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2));
    expect(calls.filter((c) => c.method === 'PATCH')[1]?.body).toEqual({ display_name: null });
  });

  it('upper-cases the currency while typing and saves it', async () => {
    server();
    fireEvent.change(await screen.findByLabelText('Currency'), { target: { value: 'usd' } });
    expect((screen.getByLabelText('Currency') as HTMLInputElement).value).toBe('USD');
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  });
});
