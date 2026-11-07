// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp, settingsFixture, signedIn } from './support/kit';

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
    fireEvent.click(await screen.findByLabelText('DoorDash'));
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
    fireEvent.click(screen.getByRole('button', { name: 'Delete Mine' }));
    await waitFor(() => expect(screen.queryByText('Mine')).toBeNull());
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
