// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from '../src/api/client';
import { createQueryClient, shouldRetry, useApiQuery, useChange } from '../src/api/query';
import { SessionProvider, settingsPatch, useSession } from '../src/session';
import { fakeServer, renderApp, settingsFixture, signedIn, testQueryClient } from './support/kit';
import type { Handler } from './support/kit';

afterEach(cleanup);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function Summary({ from }: { from: string }) {
  const q = useApiQuery('/summary', { params: { query: { from, to: from } } });
  return <p data-testid="out">{q.data ? `${q.data.from}: ${q.data.shift_count}` : 'Loading'}</p>;
}

describe('useApiQuery', () => {
  it('a slow earlier answer does not replace a newer one when the parameters change', async () => {
    // Every /summary request waits until the test answers it, so the order is the test's.
    const waiting: { from: string; signal: AbortSignal; answer: (shifts: number) => void }[] = [];
    const fetchImpl = (async (req: Request) => {
      const url = new URL(req.url);
      if (!url.pathname.endsWith('/summary')) return json({ code: 'not_found' }, 404);
      const from = url.searchParams.get('from')!;
      return new Promise<Response>((resolve) =>
        waiting.push({
          from,
          signal: req.signal,
          answer: (shift_count) => resolve(json({ from, to: from, shift_count })),
        }),
      );
    }) as typeof fetch;
    const tree = (from: string) => (
      <QueryClientProvider client={client}>
        <SessionProvider api={createApi(fetchImpl)}>
          <Summary from={from} />
        </SessionProvider>
      </QueryClientProvider>
    );
    const client = testQueryClient();
    const { rerender } = render(tree('2026-01-01'));
    await waitFor(() => expect(waiting.map((w) => w.from)).toEqual(['2026-01-01']));
    rerender(tree('2026-02-01'));
    await waitFor(() => expect(waiting.map((w) => w.from)).toEqual(['2026-01-01', '2026-02-01']));
    const [slow, fast] = waiting as [(typeof waiting)[0], (typeof waiting)[0]];

    // The request nobody shows any more is cancelled.
    expect(slow.signal.aborted).toBe(true);
    expect(fast.signal.aborted).toBe(false);

    await act(async () => fast.answer(2));
    expect((await screen.findByText('2026-02-01: 2')).textContent).toBe('2026-02-01: 2');
    await act(async () => slow.answer(1));
    expect(screen.getByTestId('out').textContent).toBe('2026-02-01: 2');
  });

  it('tries a failed request once more, but never a 4xx answer', () => {
    expect(shouldRetry(0, new ApiError(503, 'restoring', 'Restoring'))).toBe(true);
    expect(shouldRetry(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetry(1, new ApiError(503, 'restoring', 'Restoring'))).toBe(false);
    expect(shouldRetry(0, new ApiError(404, 'not_found', 'Not found'))).toBe(false);
    expect(shouldRetry(0, new ApiError(429, 'rate_limited', 'Slow down'))).toBe(false);
  });
});

// The Devices page draws until the test makes it fail.
const devices = vi.hoisted(() => ({ fail: false }));
vi.mock('../src/pages/Devices', () => ({
  Devices: () => {
    if (devices.fail) throw new Error('drawing failed');
    return <h1>Devices drawn</h1>;
  },
}));

describe('page error boundary', () => {
  it('keeps the shell, says the page failed, and Try again drops the cache and draws it again', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    devices.fail = true;
    const { queryClient } = renderApp(signedIn(), '/devices');
    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByRole('heading', { name: 'This page could not be shown' }),
    ).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    const reset = vi.spyOn(queryClient, 'resetQueries');
    devices.fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Devices drawn' })).toBeTruthy();
    expect(reset).toHaveBeenCalled();
    quiet.mockRestore();
  });

  it('clears when the driver opens another page', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    devices.fail = true;
    renderApp({ ...signedIn(), 'GET /vehicles': () => ({ body: [] }) }, '/devices');
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('link', { name: 'Vehicles' }));
    expect(await screen.findByRole('heading', { name: 'Vehicles' })).toBeTruthy();
    expect(screen.queryByText('This page could not be shown')).toBeNull();
    devices.fail = false;
    quiet.mockRestore();
  });
});

/** A signed-in screen that shows a setting and a figure the server works out from it. */
function RateForm() {
  const { state } = useSession();
  const { run } = useChange();
  const summary = useApiQuery('/summary', {
    params: { query: { from: '2026-01-01', to: '2026-01-31' } },
  });
  if (state.status !== 'ready' || !summary.data) return <p>Loading</p>;
  return (
    <>
      <p>
        Rate: {state.settings.own_mileage_rate?.cents_per_unit ?? 'none'}; deduction{' '}
        {summary.data.deduction_cents}
      </p>
      <button
        type="button"
        onClick={() =>
          void run(...settingsPatch({ own_mileage_rate: { cents_per_unit: 70, unit: 'km' } }))
        }
      >
        Save
      </button>
    </>
  );
}

describe('the cache and the session', () => {
  // A cache that keeps answers, as in the browser (tests otherwise drop them at once).
  const keeping = () => createQueryClient({ retry: false });

  it('signing out empties the cache', async () => {
    const table: Record<string, Handler> = {
      ...signedIn(),
      'GET /vehicles': () => ({ body: [] }),
      'POST /auth/logout': () => ({ status: 204 }),
    };
    const { queryClient } = renderApp(table, '/vehicles', keeping());
    await screen.findByText(/No vehicles yet/);
    expect(queryClient.getQueryCache().getAll().length).toBeGreaterThan(0);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Account' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
  });

  it('a settings change is kept in the cache and the figures computed from settings are read again', async () => {
    let current = settingsFixture({ own_mileage_rate: null });
    const table: Record<string, Handler> = {
      ...signedIn(current),
      'GET /settings': () => ({ body: current }),
      'PATCH /settings': ({ body }) => {
        current = { ...current, ...(body as object) };
        return { body: current };
      },
      // The server works the deduction out with the driver's own rate: 100 km at the rate.
      'GET /summary': () => ({
        body: { deduction_cents: (current.own_mileage_rate?.cents_per_unit ?? 0) * 100 },
      }),
    };
    const server = fakeServer(table);
    render(
      <QueryClientProvider client={testQueryClient()}>
        <SessionProvider api={server.api}>
          <RateForm />
        </SessionProvider>
      </QueryClientProvider>,
    );
    await screen.findByText('Rate: none; deduction 0');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    // The session shows the saved answer, and the summary worked out from it is read again.
    expect(await screen.findByText('Rate: 70; deduction 7000')).toBeTruthy();
    const gets = (path: string) =>
      server.calls.filter((c) => c.method === 'GET' && c.path === path).length;
    expect(gets('/summary')).toBe(2);
    // The answer of the PATCH is the new settings: they are not asked for again.
    expect(gets('/settings')).toBe(1);
  });
});
