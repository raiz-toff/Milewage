// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  apiKey,
  createQueryClient,
  errorText,
  put,
  useApiQuery,
  useChange,
} from '../src/api/query';
import { SessionProvider } from '../src/session';
import { fakeServer } from './support/kit';
import type { Handler } from './support/kit';

afterEach(cleanup);

const place = (id: number, name: string) => ({ id, name });

/**
 * A screen with the mileage rates list and the tax estimate (a figure the server works out from
 * expenses and earnings), and one change: the write path at its interface, against the fake
 * server at the fetch seam.
 */
function mount(table: Record<string, Handler>) {
  const server = fakeServer(table);
  // A cache that keeps answers nobody shows, as the browser's does (the kit's drops them).
  const client = createQueryClient({ retry: false });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <SessionProvider api={server.api}>{children}</SessionProvider>
    </QueryClientProvider>
  );
  const view = renderHook(
    () => ({
      change: useChange(),
      rates: useApiQuery('/own-mileage-rates'),
      tax: useApiQuery('/tax/{year}', { params: { path: { year: 2026 } } }),
    }),
    { wrapper },
  );
  const gets = (path: string) =>
    server.calls.filter((c) => c.method === 'GET' && c.path === path).length;
  return { ...view, server, client, gets };
}

const ready = async (r: ReturnType<typeof mount>['result']) =>
  waitFor(() => expect(r.current.rates.data && r.current.tax.data).toBeTruthy());

describe('useChange: the one write path', () => {
  it('after a change every read is asked again, the shown ones before run resolves', async () => {
    const rates = [place(1, 'Depot')];
    let taxCents = 1000;
    const { result, gets, client } = mount({
      'GET /own-mileage-rates': () => ({ body: rates }),
      'GET /tax/2026': () => ({ body: { set_aside_cents: taxCents } }),
      'POST /expenses': () => {
        taxCents = 900; // an expense lowers the estimate on the server
        return { status: 201, body: { id: 7 } };
      },
    });
    await ready(result);
    // A read seen earlier and not shown now: it is marked stale, to be read when next shown.
    client.setQueryData(apiKey('/vehicles'), []);
    let done: unknown;
    await act(async () => {
      done = await result.current.change.run((api) =>
        api.POST('/expenses', {
          body: {
            spent_on: '2026-03-15',
            category: 'fuel',
            amount_cents: 500,
            merchant: '',
            deductible: true,
            business_pct: 100,
            vehicle_id: null,
            shift_id: null,
            notes: null,
            recurrence: null,
            next_due: null,
          },
        }),
      );
    });
    expect(done).toEqual({ data: { id: 7 } });
    // Both shown reads were read again before `run` resolved, the unrelated list too.
    expect(gets('/tax/2026')).toBe(2);
    expect(gets('/own-mileage-rates')).toBe(2);
    await waitFor(() => expect(result.current.tax.data).toEqual({ set_aside_cents: 900 }));
    expect(client.getQueryState(apiKey('/vehicles'))?.isInvalidated).toBe(true);
    await waitFor(() => expect(result.current.change.error).toBeNull());
  });

  it('a failed change reads nothing again and says why in the server’s words', async () => {
    const { result, gets } = mount({
      'GET /own-mileage-rates': () => ({ body: [] }),
      'GET /tax/2026': () => ({ body: {} }),
      'POST /own-mileage-rates': () => ({
        status: 422,
        body: {
          code: 'validation_failed',
          detail: 'The rate is not valid.',
          errors: [{ path: 'cents_per_unit', message: 'must be more than 0' }],
        },
      }),
      'DELETE /own-mileage-rates/1': () => ({
        status: 429,
        body: { detail: 'Too many requests.' },
      }),
    });
    await ready(result);
    let done: unknown = 'not yet';
    await act(async () => {
      done = await result.current.change.run((api) =>
        api.POST('/own-mileage-rates', {
          body: { effective_from: null, cents_per_unit: 0, unit: 'km' },
        }),
      );
    });
    expect(done).toBeNull();
    // The first field error, as `describe` words it for a form.
    await waitFor(() =>
      expect(result.current.change.error).toBe('cents_per_unit: must be more than 0'),
    );
    expect(gets('/own-mileage-rates')).toBe(1);
    expect(gets('/tax/2026')).toBe(1);
    // A problem without field errors: its detail.
    await act(async () => {
      await result.current.change.run((api) =>
        api.DELETE('/own-mileage-rates/{id}', { params: { path: { id: 1 } } }),
      );
    });
    await waitFor(() => expect(result.current.change.error).toBe('Too many requests.'));
  });

  it('says the server could not be reached when the request does not get through', async () => {
    const { result } = mount({
      'GET /own-mileage-rates': () => ({ body: [] }),
      'GET /tax/2026': () => ({ body: {} }),
    });
    await ready(result);
    await act(async () => {
      await result.current.change.run(() => Promise.reject(new TypeError('Failed to fetch')));
    });
    await waitFor(() =>
      expect(result.current.change.error).toBe('The server could not be reached.'),
    );
  });

  it('is busy while the change is on its way', async () => {
    let answer: () => void = () => {};
    const gate = new Promise<void>((resolve) => (answer = resolve));
    const { result } = mount({
      'GET /own-mileage-rates': () => ({ body: [] }),
      'GET /tax/2026': () => ({ body: {} }),
    });
    await ready(result);
    expect(result.current.change.busy).toBe(false);
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.change.run(async () => {
        await gate;
        return { data: 1, response: new Response(null, { status: 204 }) };
      });
    });
    await waitFor(() => expect(result.current.change.busy).toBe(true));
    await act(async () => {
      answer();
      await pending;
    });
    await waitFor(() => expect(result.current.change.busy).toBe(false));
  });

  it('puts a known answer in the cache and does not ask for it again', async () => {
    const { result, gets } = mount({
      'GET /own-mileage-rates': () => ({ body: [place(1, 'Depot')] }),
      'GET /tax/2026': () => ({ body: { set_aside_bp: 2500 } }),
      'PUT /tax/2026': ({ body }) => ({
        body: { set_aside_bp: (body as { set_aside_bp: number }).set_aside_bp },
      }),
    });
    await ready(result);
    await act(async () => {
      await result.current.change.run(
        (api) =>
          api.PUT('/tax/{year}', {
            params: { path: { year: 2026 } },
            body: { set_aside_bp: 3000 },
          }),
        (next) => [put('/tax/{year}', { path: { year: 2026 } }, next as never)],
      );
    });
    await waitFor(() => expect(result.current.tax.data).toEqual({ set_aside_bp: 3000 }));
    expect(gets('/tax/2026')).toBe(1);
    expect(gets('/own-mileage-rates')).toBe(2);
  });

  it('a page check shares the error line until the next change, and reads fail on it too', async () => {
    const { result } = mount({
      'GET /own-mileage-rates': () => ({
        status: 500,
        body: { detail: 'The rates could not be read.' },
      }),
      'GET /tax/2026': () => ({ body: {} }),
      'DELETE /own-mileage-rates/1': () => ({ status: 200, body: {} }),
    });
    await waitFor(() => expect(result.current.rates.error).toBeTruthy());
    const line = () => errorText(result.current.change, result.current.rates);
    expect(line()).toBe('The rates could not be read.');
    act(() => result.current.change.setError('Enter a radius of at least 25 m.'));
    expect(line()).toBe('Enter a radius of at least 25 m.');
    await act(async () => {
      await result.current.change.run((api) =>
        api.DELETE('/own-mileage-rates/{id}', { params: { path: { id: 1 } } }),
      );
    });
    await waitFor(() => expect(result.current.change.error).toBeNull());
  });
});
