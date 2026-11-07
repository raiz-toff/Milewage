// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp, settingsFixture, signedIn, menu } from './support/kit';

afterEach(cleanup);

const phone = (over: object = {}) => ({
  id: 1,
  name: 'Pixel',
  platform: 'android',
  created_at: 1_700_000_000_000,
  last_seen_at: 1_700_000_600_000,
  revoked_at: null,
  ...over,
});

function server(initial = [phone()], apk = false) {
  let devices = initial;
  const table = {
    ...signedIn(),
    'GET /devices': () => ({ body: devices }),
    'POST /pairing-tokens': () => ({
      status: 201,
      body: {
        token: 'mwp_x',
        expires_at: 1_700_000_600_000,
        qr_payload: 'milewage://pair?v=1&u=https%3A%2F%2Fhost&t=mwp_x',
        pair_url: 'https://host/pair#v=1&t=mwp_x',
      },
    }),
    ...(apk ? { 'HEAD /app/android.apk': () => ({}) } : {}),
    'PATCH /devices/1': ({ body }: { body: unknown }) => {
      devices = [phone({ name: (body as { name: string }).name })];
      return { body: devices[0] };
    },
    'DELETE /devices/1': () => {
      devices = [phone({ revoked_at: 1_700_000_900_000 })];
      return { status: 204 };
    },
  };
  return renderApp(table as never, '/devices');
}

describe('devices page', () => {
  it('lists devices with their state', async () => {
    server();
    expect(await screen.findByText('Pixel')).toBeTruthy();
    expect(screen.getByText('active')).toBeTruthy();
  });

  it('shows an empty state', async () => {
    server([]);
    expect(await screen.findByText('No phone is paired yet.')).toBeTruthy();
  });

  it('pairs: shows the QR code, the payload and an expiry in the instance time zone', async () => {
    server();
    await screen.findByText('Pixel');
    fireEvent.click(screen.getByRole('button', { name: 'Pair a phone' }));
    expect(await screen.findByRole('img', { name: 'Pairing code' })).toBeTruthy();
    expect(screen.getByText(/milewage:\/\/pair\?v=1/)).toBeTruthy();
    // 1_700_000_600_000 ms is 2023-11-14 22:23:20 UTC, 17:23 in Toronto.
    expect(screen.getByText(/until 17:23/)).toBeTruthy();
    expect(screen.getByText(/Open MileWage on your phone and tap Scan the code/)).toBeTruthy();
    // No app file on this server and not on a phone: neither button.
    expect(screen.queryByRole('link', { name: /Get the app|Open in the MileWage app/ })).toBeNull();
  });

  it('offers Get the app when the server has it, and Open in the app on a phone', async () => {
    const agent = vi
      .spyOn(navigator, 'userAgent', 'get')
      .mockReturnValue('Mozilla/5.0 (Linux; Android 15)');
    server([phone()], true);
    await screen.findByText('Pixel');
    fireEvent.click(screen.getByRole('button', { name: 'Pair a phone' }));
    const open = await screen.findByRole('link', { name: 'Open in the MileWage app' });
    expect(open.getAttribute('href')).toBe('milewage://pair?v=1&u=https%3A%2F%2Fhost&t=mwp_x');
    const get = await screen.findByRole('link', { name: 'Get the app' });
    expect(get.getAttribute('href')).toBe('/api/v1/app/android.apk');
    agent.mockRestore();
  });

  it('renames and reads the new name back from the server', async () => {
    const { calls } = server();
    await screen.findByText('Pixel');
    menu('Pixel', 'Rename');
    fireEvent.change(screen.getByLabelText('New name for Pixel'), {
      target: { value: 'Bike mount' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Bike mount')).toBeTruthy();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'Bike mount' });
  });

  it('revokes only after a second click, then shows it revoked', async () => {
    const { calls } = server();
    await screen.findByText('Pixel');
    menu('Pixel', 'Revoke');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    await waitFor(() => expect(screen.getByText('revoked')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Actions for Pixel' })).toBeNull();
  });

  it('is absent from navigation and by URL when the devices module is off', async () => {
    renderApp({ ...signedIn(settingsFixture({ modules: { devices: false } })) }, '/devices');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByText('Devices')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Devices' })).toBeNull();
  });
});
