// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import text from '../../../CHANGELOG.md?raw';
import { version } from '../package.json';
import type { Modules, Settings } from '../src/api/client';
import { changelogSection, GROUPS } from '../src/help/catalog';
import { catalog } from '../src/help/content';
import { resetUpdates, startUpdates } from '../src/pwa/update';
import { shift, stop, trip } from './support/fixtures';
import { DASHBOARD, renderApp, settingsFixture, signedIn } from './support/kit';
import type { Handler } from './support/kit';

// Help pages (ADR 0001, 0002), at the module's interface: the whole app on the fake server.

afterEach(() => {
  cleanup();
  resetUpdates();
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
});

const GITHUB = `https://github.com/raiz-toff/Milewage/blob/v${version}`;

const status = (app_version: string) => ({
  app_version,
  schema_version: 7,
  sqlite_version: '3.52.0',
  db_bytes: 4_000_000,
  wal_bytes: 0,
  disk_free_bytes: 50_000_000_000,
  disk_state: 'ok',
  last_backup: null,
  offsite: { last_download_at: null, synced_elsewhere_at: null, reminder_due: false },
  paired_device_count: 1,
  mode: 'normal',
});

/** Every screen a test here opens, with what it reads. */
const table = (
  settings: Settings,
  extra: Record<string, Handler> = {},
): Record<string, Handler> => ({
  ...signedIn(settings),
  'GET /system/status': () => ({ body: status(version) }),
  'GET /shifts': () => ({ body: { items: [], next_cursor: null } }),
  'GET /shifts/1': () => ({ body: shift() }),
  'GET /shifts/1/trips': () => ({ body: [trip(1)] }),
  'GET /shifts/1/stops': () => ({ body: [stop(1)] }),
  'GET /devices': () => ({ body: [] }),
  'GET /backups': () => ({ body: [] }),
  'GET /vehicles': () => ({ body: [] }),
  ...extra,
});

const open = (
  url: string,
  over: { help_enabled?: boolean; modules?: Partial<Modules> } = {},
  extra: Record<string, Handler> = {},
) => renderApp(table(settingsFixture(over), extra), url);

const navNames = async () =>
  within(await screen.findByRole('navigation', { name: 'Main' }))
    .getAllByRole('link')
    .map((a) => a.textContent);

const title = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name });

describe('the Help screen', () => {
  it('is in the sidebar after Settings, and its index lists every page by group for this version', async () => {
    open('/help');
    expect(await title('Help')).toBeTruthy();
    const names = await navNames();
    expect(names.slice(-2)).toEqual(['Settings', 'Help']);
    expect(screen.getByText(`How MileWage works, in plain words. For MileWage ${version}.`));
    for (const g of GROUPS) {
      const region = screen.getByRole('region', { name: g.label });
      for (const p of catalog.pages.filter((x) => x.group === g.id)) {
        const link = within(region).getByRole('link', { name: new RegExp(`^${p.title}`) });
        expect(link.getAttribute('href')).toBe(`/help/${p.slug}`);
        expect(link.textContent).toContain(p.summary);
      }
    }
  });

  it('with Help off: no sidebar item, the addresses lead to the dashboard, no help link on a screen', async () => {
    open('/help', { help_enabled: false });
    expect(await screen.findByRole('heading', { name: DASHBOARD })).toBeTruthy();
    expect(await navNames()).not.toContain('Help');
    cleanup();
    open('/help/faq', { help_enabled: false });
    expect(await screen.findByRole('heading', { name: DASHBOARD })).toBeTruthy();
    cleanup();
    open('/exports', { help_enabled: false });
    expect(await title('Exports')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'What to give your accountant' })).toBeNull();
  });

  it('shows a page with GitHub anchors, its contents and the version it describes', async () => {
    open('/help/how-miles-are-counted');
    expect(await title('How miles are counted')).toBeTruthy();
    const h2 = screen.getByRole('heading', { level: 2, name: 'What the phone records' });
    expect(h2.id).toBe('what-the-phone-records');
    const toc = screen.getByRole('navigation', { name: 'On this page' });
    expect(
      within(toc).getByRole('link', { name: 'What the phone records' }).getAttribute('href'),
    ).toBe('#what-the-phone-records');
    expect(screen.getByText(`This page describes MileWage ${version}.`, { exact: false }));
    const github = screen.getByRole('link', { name: 'Read it on GitHub' });
    expect(github.getAttribute('href')).toBe(`${GITHUB}/docs/help/how-miles-are-counted.md`);
    expect(github.getAttribute('rel')).toContain('noreferrer');
    // The page list beside it, and the way back.
    const list = screen.getByRole('navigation', { name: 'Help pages' });
    expect(within(list).getByRole('link', { name: 'Questions and answers' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'All help pages' }).getAttribute('href')).toBe('/help');
  });

  it('links a page to another inside the app, and another repository file to GitHub at this version', async () => {
    open('/help/faq');
    expect(await title('Questions and answers')).toBeTruthy();
    const upgrade = within(screen.getByRole('article')).getByRole('link', {
      name: 'infra/docs/upgrade.md',
    });
    expect(upgrade.getAttribute('href')).toBe(`${GITHUB}/infra/docs/upgrade.md`);
    expect(upgrade.getAttribute('target')).toBe('_blank');
    expect(upgrade.getAttribute('rel')).toContain('noreferrer');
    const key = within(screen.getByRole('article')).getByRole('link', {
      name: 'If you lose your recovery key',
    });
    expect(key.getAttribute('href')).toBe('/help/if-you-lose-your-recovery-key');
    fireEvent.click(key);
    expect(await title('If you lose your recovery key')).toBeTruthy();
  });

  it('leaves out a page whose module is off, everywhere, as if it did not exist', async () => {
    open('/help', { modules: { expenses: false } });
    expect(await title('Help')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /^Expenses and receipts/ })).toBeNull();
    expect(screen.getByRole('link', { name: /^Earnings and platforms/ })).toBeTruthy();
    cleanup();
    open('/help/expenses-and-receipts', { modules: { expenses: false } });
    expect(
      await screen.findByText('There is no help page called "expenses-and-receipts".'),
    ).toBeTruthy();
    cleanup();
    open('/help/expenses-and-receipts');
    expect(await title('Expenses and receipts')).toBeTruthy();
    cleanup();
    // A link to it from another page is plain text: no dead end.
    open('/help/shifts-and-trips', { modules: { earnings: false } });
    const article = within(await screen.findByRole('article'));
    expect(article.getAllByText('Earnings and platforms').length).toBeGreaterThan(0);
    expect(article.queryByRole('link', { name: 'Earnings and platforms' })).toBeNull();
    cleanup();
    open('/help/shifts-and-trips');
    expect(
      within(await screen.findByRole('article'))
        .getAllByRole('link', { name: 'Earnings and platforms' })[0]!
        .getAttribute('href'),
    ).toBe('/help/earnings-and-platforms');
  });

  it('says so for an unknown page, with the way back', async () => {
    open('/help/nope');
    expect(await screen.findByText('There is no help page called "nope".')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'All help pages' }));
    expect(await title('Help')).toBeTruthy();
  });

  it("What's new is this version's section of the changelog, and nothing from Unreleased", async () => {
    const page = catalog.pages.find((p) => p.slug === 'whats-new')!;
    open('/help/whats-new');
    expect(await title(`What's new in MileWage ${version}`)).toBeTruthy();
    const first = page.headings[0]!;
    expect(screen.getByRole('heading', { level: 2, name: first.text }).id).toBe(first.id);
    const ours = changelogSection(text, version);
    const only = changelogSection(text, 'Unreleased')
      .split('\n')
      .filter((l) => l.startsWith('- '))
      .map((l) => l.slice(2, 50))
      .find((l) => !ours.includes(l));
    if (only) expect(screen.queryByText(only, { exact: false })).toBeNull();
  });
});

describe('the version note', () => {
  const seen = (calls: { path: string }[]) =>
    waitFor(() => expect(calls.some((c) => c.path === '/system/status')).toBe(true));

  it('says nothing when the server runs the version the pages describe', async () => {
    const { queryClient } = open('/help/faq');
    expect(await title('Questions and answers')).toBeTruthy();
    await waitFor(() =>
      expect(queryClient.getQueryState(['/system/status', {}])?.status).toBe('success'),
    );
    expect(screen.queryByText(/Your server runs MileWage/)).toBeNull();
  });

  it('says nothing when the server cannot say', async () => {
    const { calls, queryClient } = open(
      '/help',
      {},
      { 'GET /system/status': () => ({ status: 503 }) },
    );
    await seen(calls);
    await waitFor(() =>
      expect(queryClient.getQueryState(['/system/status', {}])?.status).toBe('error'),
    );
    expect(screen.queryByText(/Your server runs MileWage/)).toBeNull();
  });

  it('names both versions when they differ; Reload applies the waiting version', async () => {
    Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });
    const update = vi.fn(async () => {});
    startUpdates((o: RegisterSWOptions) => {
      o.onNeedRefresh?.();
      return update;
    });
    open('/help/faq', {}, { 'GET /system/status': () => ({ body: status('9.9.9') }) });
    expect(
      await screen.findByText(`Your server runs MileWage 9.9.9. These pages describe ${version}.`),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'upgrade guide' }).getAttribute('href')).toBe(
      `${GITHUB}/infra/docs/upgrade.md`,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(update).toHaveBeenCalledWith(true);
  });
});

describe('Settings > Help pages', () => {
  it('turns Help off with the Save bar; the sidebar then has no Help', async () => {
    const { calls } = open(
      '/settings/help',
      {},
      {
        'PATCH /settings': () => ({ body: settingsFixture({ help_enabled: false }) }),
      },
    );
    const sw = await screen.findByRole('switch', { name: 'Show help pages' });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(await navNames()).toContain('Help');
    fireEvent.click(sw);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ help_enabled: false });
    await waitFor(async () => expect(await navNames()).not.toContain('Help'));
    expect(
      screen.getByRole('switch', { name: 'Show help pages' }).getAttribute('aria-checked'),
    ).toBe('false');
  });
});

describe('help links on screens', () => {
  const places = [
    { url: '/shifts/1', page: 'how-miles-are-counted', name: 'How miles are counted' },
    { url: '/shifts/1', page: 'active-and-deadhead', name: 'About the estimate' },
    { url: '/devices', page: 'if-your-phone-is-lost', name: 'If your phone is lost' },
    { url: '/backups', page: 'if-you-lose-your-recovery-key', name: 'What a new key changes' },
    { url: '/exports', page: 'for-your-accountant', name: 'What to give your accountant' },
  ];

  it.each(places)('$url links to $page while Help is on, and not when it is off', async (p) => {
    open(p.url);
    const link = await screen.findByRole('link', { name: p.name });
    expect(link.getAttribute('href')).toBe(`/help/${p.page}`);
    cleanup();
    open(p.url, { help_enabled: false });
    // Wait for the part of the screen the link sits in, then make sure it is not there.
    await screen.findByRole('heading', { level: 1 });
    if (p.page === 'active-and-deadhead')
      await screen.findByRole('table', { name: 'Detected stops' });
    if (p.page === 'how-miles-are-counted') await screen.findByRole('region', { name: 'Checks' });
    if (p.page === 'if-you-lose-your-recovery-key')
      await screen.findByRole('region', { name: 'Lost your recovery key?' });
    expect(screen.queryByRole('link', { name: p.name })).toBeNull();
  });
});
