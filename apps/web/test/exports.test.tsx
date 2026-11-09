// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileNameOf, spanDays } from '../src/pages/Exports';
import type { Modules } from '../src/api/client';
import { shift } from './support/fixtures';
import {
  renderApp,
  settingsFixture,
  signedIn,
  pick,
  pickDay,
  dateButton,
  pickDate,
  DASHBOARD,
} from './support/kit';
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
  it('each registered file under its purpose with its own button, nothing for pdf when it is not registered', async () => {
    open();
    const accountant = within(await screen.findByRole('region', { name: 'For your accountant' }));
    expect(accountant.getByRole('button', { name: 'Download Mileage log' })).toBeTruthy();
    expect(accountant.getByLabelText('CSV rows')).toBeTruthy();
    const routes = within(screen.getByRole('region', { name: 'Routes for map apps' }));
    expect(routes.getByRole('button', { name: 'Download GPX' })).toBeTruthy();
    expect(routes.getByRole('button', { name: 'Download GeoJSON' })).toBeTruthy();
    expect(routes.queryByLabelText('CSV rows')).toBeNull();
    expect(screen.queryByRole('button', { name: /Mileage report|PDF/ })).toBeNull();
    expect(routes.getAllByText(/No money, labels or notes/).length).toBe(2);
    expect(screen.queryByRole('heading', { name: 'Formats' })).toBeNull();
  });

  it('a preset period by default; the date pickers only for Custom', async () => {
    const seen: string[] = [];
    open(
      { exporters: ['csv', 'gpx', 'geojson', 'tax_summary'] },
      {
        'GET /exports/csv': ({ url }) => (seen.push(url.search), file({ body: undefined, url })),
      },
    );
    const period = await screen.findByRole('radiogroup', { name: 'Period' });
    expect(
      within(period).getByRole('radio', { name: 'This year' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(screen.getByText('Jan 1, 2026 \u2013 Mar 15, 2026')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^From/ })).toBeNull();
    expect(screen.getByText(/estimate for 2026/)).toBeTruthy();
    fireEvent.click(within(period).getByRole('radio', { name: 'Last month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download Mileage log' }));
    await waitFor(() => expect(saved.length).toBe(1));
    fireEvent.click(within(period).getByRole('radio', { name: 'Last year' }));
    expect(screen.getByText(/estimate for 2025/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Download Mileage log' }));
    await waitFor(() => expect(saved.length).toBe(2));
    const range = (s: string) => {
      const q = new URLSearchParams(s);
      return [q.get('from'), q.get('to')];
    };
    expect(range(seen[0]!)).toEqual(['2026-02-01', '2026-02-28']);
    expect(range(seen[1]!)).toEqual(['2025-01-01', '2025-12-31']);
    fireEvent.click(within(period).getByRole('radio', { name: 'Custom' }));
    expect(dateButton('From').textContent).toBe('Jan 1, 2025');
    expect(dateButton('To').textContent).toBe('Dec 31, 2025');
  });

  it('downloads the period with vehicle and level, and saves under the server name', async () => {
    const { calls } = open();
    pick(await screen.findByLabelText('Vehicle'), '2');
    pick(screen.getByLabelText('CSV rows'), 'shift');
    fireEvent.click(screen.getByRole('button', { name: 'Download Mileage log' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Download Mileage log' }));
    await waitFor(() => expect(seen.length).toBe(1));
    const q = new URLSearchParams(seen[0]);
    expect(Object.fromEntries(q)).toEqual({
      from: '2026-01-01',
      to: '2026-03-15',
      vehicle_id: '2',
      level: 'shift',
    });
  });

  it('the period is picked on calendars and sent as YYYY-MM-DD', async () => {
    const seen: string[] = [];
    open(
      {},
      { 'GET /exports/csv': ({ url }) => (seen.push(url.search), file({ body: undefined, url })) },
    );
    fireEvent.click(await screen.findByRole('radio', { name: 'Last month' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    expect(document.querySelector('input[type="date"]')).toBeNull();
    pickDay('From', /February 20th, 2026/);
    pickDay('To', /February 27th, 2026/);
    expect(dateButton('From').textContent).toBe('Feb 20, 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Download Mileage log' }));
    await waitFor(() => expect(seen.length).toBe(1));
    const q = new URLSearchParams(seen[0]);
    expect([q.get('from'), q.get('to')]).toEqual(['2026-02-20', '2026-02-27']);
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
    fireEvent.click(await screen.findByRole('radio', { name: 'Custom' }));
    pickDate('From', '2025-01-01');
    expect(screen.getByRole('alert').textContent).toContain('at most 366 days');
    const download = screen.getByRole('button', { name: 'Download Mileage log' });
    expect((download as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(download);
    pickDate('From', '2026-03-16');
    expect(screen.getByRole('alert').textContent).toContain('must not be after');
    fireEvent.click(screen.getByRole('button', { name: 'Download GPX' }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Download Mileage log' }));
    const accountant = within(screen.getByRole('region', { name: 'For your accountant' }));
    expect((await accountant.findByRole('alert')).textContent).toContain('Too many exports.');
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
    expect(await screen.findByRole('heading', { name: DASHBOARD })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Exports' })).toBeNull();
  });

  it('only the registered formats get buttons (gpx alone)', async () => {
    open({ exporters: ['gpx'] });
    await screen.findByRole('button', { name: 'Download GPX' });
    expect(screen.queryByRole('button', { name: 'Download Mileage log' })).toBeNull();
    expect(screen.queryByLabelText('CSV rows')).toBeNull();
    expect(screen.queryByRole('region', { name: 'For your accountant' })).toBeNull();
  });
});
