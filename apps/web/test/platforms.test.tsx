// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { menu, renderApp, settingsFixture, signedIn } from './support/kit';

afterEach(cleanup);

interface P {
  slug: string;
  label: string;
  custom: boolean;
  color: null;
  emoji: null;
  active: boolean;
  sort: number;
  hourly_target_cents: null;
  logo_version: string | null;
}
const p = (slug: string, label: string, over: Partial<P> = {}): P => ({
  slug,
  label,
  custom: false,
  color: null,
  emoji: null,
  active: true,
  sort: 0,
  hourly_target_cents: null,
  logo_version: null,
  ...over,
});

function server(modules: { platforms: boolean } = { platforms: true }) {
  let rows = [p('doordash', 'DoorDash'), p('mine', 'Mine', { custom: true })];
  return renderApp(
    {
      ...signedIn(settingsFixture({ modules })),
      'GET /platforms': () => ({ body: rows }),
      'PUT /platforms/doordash': ({ body }) => {
        rows = rows.map((r) => (r.slug === 'doordash' ? { ...r, ...(body as object) } : r));
        return { body: rows[0] };
      },
      'PUT /platforms/skip_it': ({ body }) => {
        rows = [...rows, p('skip_it', (body as { label: string }).label, { custom: true })];
        return { body: rows.at(-1) };
      },
      'DELETE /platforms/mine': () => {
        rows = rows.filter((r) => r.slug !== 'mine');
        return { status: 204 };
      },
      'PUT /platforms/doordash/logo': () => {
        rows = rows.map((r) => (r.slug === 'doordash' ? { ...r, logo_version: 'abc123' } : r));
        return { status: 201, body: { slug: 'doordash', logo_version: 'abc123' } };
      },
      'DELETE /platforms/doordash/logo': () => {
        rows = rows.map((r) => (r.slug === 'doordash' ? { ...r, logo_version: null } : r));
        return { status: 204 };
      },
    },
    '/settings/platforms',
  );
}

describe('platforms card (module platforms)', () => {
  it('lists platforms, switches one off, adds a custom one and deletes it', async () => {
    const s = server();
    const doordash = await screen.findByLabelText('DoorDash');
    // Each row has the platform's badge (plan 25): initials, no bundled logo.
    const region = screen.getByRole('region', { name: 'Platforms' });
    const badge = (slug: string) => region.querySelector(`[data-platform="${slug}"]`);
    expect(badge('doordash')?.textContent).toBe('DD');
    expect(badge('doordash')?.querySelector('svg, img')).toBeNull();
    expect(badge('mine')?.textContent).toBe('M');
    fireEvent.click(doordash);
    await waitFor(() =>
      expect(s.calls.find((c) => c.path === '/platforms/doordash')?.body).toEqual({
        active: false,
      }),
    );
    fireEvent.change(screen.getByLabelText('Add a platform'), { target: { value: 'Skip It' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Skip It')).toBeTruthy();
    expect(s.calls.find((c) => c.path === '/platforms/skip_it')?.body).toEqual({
      label: 'Skip It',
    });
    menu('Mine', 'Delete');
    await waitFor(() => expect(screen.queryByText('Mine')).toBeNull());
  });

  it("adds the driver's own logo as the raw image, shows it in the badge, and removes it", async () => {
    const s = server();
    await screen.findByLabelText('DoorDash');
    const region = screen.getByRole('region', { name: 'Platforms' });
    const badge = () => region.querySelector('[data-platform="doordash"]')!;
    expect(region.textContent).toMatch(/stays on your server and in its backups/);
    menu('DoorDash', 'Add logo');
    const input = screen.getByLabelText('Logo image') as HTMLInputElement;
    // Wrong type or too large: a plain message, nothing sent.
    const svg = new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' });
    fireEvent.change(input, { target: { files: [svg] } });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Use a PNG, JPEG or WebP under 256 KB.',
    );
    const big = new File([new Uint8Array(256 * 1024 + 1)], 'big.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [big] } });
    expect(s.calls.some((c) => c.path === '/platforms/doordash/logo')).toBe(false);
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'dd.png', {
      type: 'image/png',
    });
    fireEvent.change(input, { target: { files: [png] } });
    await waitFor(() => expect(badge().querySelector('img')).not.toBeNull());
    expect(
      s.calls.find((c) => c.method === 'PUT' && c.path === '/platforms/doordash/logo')?.contentType,
    ).toBe('image/png');
    expect(badge().querySelector('img')!.getAttribute('src')).toBe(
      '/api/v1/platforms/doordash/logo?v=abc123',
    );
    menu('DoorDash', 'Remove logo');
    await waitFor(() => expect(badge().textContent).toBe('DD'));
    expect(badge().querySelector('img')).toBeNull();
  });

  it('is absent when the module is off, and asks the server for nothing', async () => {
    const s = server({ platforms: false });
    await screen.findByLabelText('Name');
    const sections = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(sections).queryByRole('link', { name: 'Platforms' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Platforms' })).toBeNull();
    expect(s.calls.some((c) => c.path.startsWith('/platforms'))).toBe(false);
  });
});
