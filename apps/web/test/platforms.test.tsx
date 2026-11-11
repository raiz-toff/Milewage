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
    },
    '/settings/platforms',
  );
}

describe('platforms card (module platforms)', () => {
  it('lists platforms, switches one off, adds a custom one and deletes it', async () => {
    const s = server();
    const doordash = await screen.findByLabelText('DoorDash');
    // Each row has the platform's badge (plan 25): initials, no logo.
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

  it('picks a badge colour from named presets, and goes back to the brand colour', async () => {
    const s = server();
    await screen.findByLabelText('DoorDash');
    menu('DoorDash', 'Change colour');
    const group = screen.getByRole('group', { name: 'Badge colour for DoorDash' });
    const radios = within(group).getAllByRole('radio');
    // The default first, then every preset, each named for a screen reader.
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Brand colour',
      'Red',
      'Orange',
      'Green',
      'Teal',
      'Cyan',
      'Blue',
      'Violet',
      'Magenta',
      'Slate',
    ]);
    // Each choice shows the badge it would give.
    expect(radios.map((r) => r.closest('label')!.textContent)).toEqual(radios.map(() => 'DD'));
    expect(
      (within(group).getByRole('radio', { name: 'Brand colour' }) as HTMLInputElement).checked,
    ).toBe(true);
    fireEvent.click(within(group).getByRole('radio', { name: 'Teal' }));
    await waitFor(() =>
      expect(s.calls.findLast((c) => c.path === '/platforms/doordash')?.body).toEqual({
        color: '#0f766e',
      }),
    );
    await waitFor(() =>
      expect((within(group).getByRole('radio', { name: 'Teal' }) as HTMLInputElement).checked).toBe(
        true,
      ),
    );
    fireEvent.click(within(group).getByRole('radio', { name: 'Brand colour' }));
    await waitFor(() =>
      expect(s.calls.findLast((c) => c.path === '/platforms/doordash')?.body).toEqual({
        color: null,
      }),
    );
    fireEvent.click(within(group).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('group', { name: 'Badge colour for DoorDash' })).toBeNull();
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
