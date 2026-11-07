// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileNameOf, spanDays } from '../src/pages/Exports';
import type { Modules } from '../src/api/client';
import { shift } from './support/fixtures';
import { renderApp, settingsFixture, signedIn, pick } from './support/kit';
import type { Handler } from './support/kit';

const saved: { name: string; blob: Blob }[] = [];
let lastBlob: Blob | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-15T15:00:00Z'));
  saved.length = 0;
  URL.createObjectURL = (b: Blob | MediaSource) => {
    lastBlob = b as Blob;
    return 'blob:x';
  };
  URL.revokeObjectURL = () => undefined;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push({ name: this.download, blob: lastBlob! });
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const file: Handler = () => ({
  body: { rows: 1 },
  headers: { 'content-disposition': 'attachment; filename="milewage-trips.csv"' },
});

function open(
  modules: Partial<Modules> = {},
  extra: Record<string, Handler> = {},
  url = '/exports',
) {
  return renderApp(
    {
      ...signedIn(settingsFixture({ modules })),
      'GET /vehicles': () => ({
        body: [
          { id: 1, name: 'Corolla', kind: 'car', created_at: 1, archived_at: null },
          { id: 2, name: 'Bike', kind: 'bicycle', created_at: 1, archived_at: null },
        ],
      }),
      'GET /shifts/1': () => ({ body: shift() }),
      'GET /exports/csv': file,
      'GET /exports/gpx': file,
      'GET /exports/geojson': file,
      ...extra,
    },
    url,
  );
}

describe('exports screen', () => {
  it('one button per registered exporter, nothing for pdf when it is not registered', async () => {
    open();
    expect(await screen.findByRole('button', { name: 'Download CSV' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download GPX' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download GeoJSON' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /PDF/ })).toBeNull();
    expect(screen.getAllByText(/No payouts, labels or notes/).length).toBe(2);
  });

  it('downloads the period with vehicle and level, and saves under the server name', async () => {
    const { calls } = open();
    pick(await screen.findByLabelText('Vehicle'), '2');
    pick(screen.getByLabelText('CSV rows'), 'shift');
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(saved.length).toBe(1));
    expect(saved[0]!.name).toBe('milewage-trips.csv');
    const urlOf = calls.find((c) => c.path === '/exports/csv');
    expect(urlOf).toBeTruthy();
  });

  it('sends the dates, vehicle and level in the query', async () => {
    const seen: string[] = [];
    open(
      {},
      {
        'GET /exports/csv': ({ url }) => {
          seen.push(url.search);
          return file({ body: undefined, url });
        },
      },
    );
    pick(await screen.findByLabelText('Vehicle'), '2');
    pick(screen.getByLabelText('CSV rows'), 'shift');
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(seen.length).toBe(1));
    const q = new URLSearchParams(seen[0]);
    expect(Object.fromEntries(q)).toEqual({
      from: '2026-02-14',
      to: '2026-03-15',
      vehicle_id: '2',
      level: 'shift',
    });
  });

  it('GPX gets no level parameter', async () => {
    const seen: string[] = [];
    open(
      {},
      {
        'GET /exports/gpx': ({ url }) => {
          seen.push(url.search);
          return file({ body: undefined, url });
        },
      },
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Download GPX' }));
    await waitFor(() => expect(seen.length).toBe(1));
    expect(seen[0]).not.toContain('level');
  });

  it('refuses a period over 366 days or reversed, without a call', async () => {
    const { calls } = open();
    await screen.findByRole('button', { name: 'Download CSV' });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2025-01-01' } });
    expect(screen.getByRole('alert').textContent).toContain('at most 366 days');
    expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-03-16' } });
    expect(screen.getByRole('alert').textContent).toContain('must not be after');
    expect(calls.some((c) => c.path.startsWith('/exports'))).toBe(false);
  });

  it("shows the server's refusal, e.g. the rate limit, and saves nothing", async () => {
    open(
      {},
      {
        'GET /exports/csv': () => ({
          status: 429,
          body: { code: 'rate_limited', detail: 'Too many exports.' },
          headers: { 'retry-after': '30' },
        }),
      },
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Download CSV' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Too many exports.');
    expect(saved.length).toBe(0);
  });

  it('the shift detail has per-shift buttons that ask for that shift', async () => {
    const seen: string[] = [];
    open(
      {},
      {
        'GET /exports/gpx': ({ url }) => {
          seen.push(url.search);
          return file({ body: undefined, url });
        },
      },
      '/shifts/1',
    );
    const region = within(await screen.findByRole('region', { name: 'Export' }));
    fireEvent.click(region.getByRole('button', { name: 'Download GPX' }));
    await waitFor(() => expect(saved.length).toBe(1));
    expect(seen[0]).toBe('?shift_id=1');
  });

  it('helpers: file name and period length', () => {
    expect(fileNameOf('attachment; filename="a b.csv"', 'x')).toBe('a b.csv');
    expect(fileNameOf("attachment; filename*=UTF-8''a%20b.csv", 'x')).toBe('a b.csv');
    expect(fileNameOf(null, 'fallback.csv')).toBe('fallback.csv');
    expect(spanDays('2026-01-01', '2026-01-01')).toBe(1);
    expect(spanDays('2025-01-01', '2025-12-31')).toBe(365);
  });
});

describe('exporters module off', () => {
  it('no Exports screen in the navigation, none on the shift, no request', async () => {
    const { calls } = open({ exporters: [] }, {}, '/shifts/1');
    await screen.findByRole('heading', { name: /Nov 14, 2023/ });
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByRole('link', { name: 'Exports' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Export' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();
    expect(calls.some((c) => c.path.startsWith('/exports'))).toBe(false);
  });

  it('its URL leads to the first visible screen', async () => {
    open({ exporters: [] });
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Exports' })).toBeNull();
  });

  it('only the registered formats get buttons (gpx alone)', async () => {
    open({ exporters: ['gpx'] });
    await screen.findByRole('button', { name: 'Download GPX' });
    expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull();
    expect(screen.queryByLabelText('CSV rows')).toBeNull();
  });
});
