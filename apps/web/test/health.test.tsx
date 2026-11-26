// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp, settingsFixture, signedIn } from './support/kit';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const update = (over: object = {}) => ({
  enabled: true,
  current_version: '0.3.1',
  latest_version: null,
  available: false,
  release_url: null,
  notes_url: 'https://github.com/raiz-toff/Milewage/blob/v0.3.1/CHANGELOG.md',
  checked_at: null,
  check_failed: false,
  ...over,
});
const newer = update({
  latest_version: '0.4.0',
  available: true,
  release_url: 'https://github.com/raiz-toff/Milewage/releases/tag/v0.4.0',
  notes_url: 'https://github.com/raiz-toff/Milewage/releases/tag/v0.4.0',
  checked_at: 1_700_000_000_000,
});
const check = (over: object = {}) => ({
  id: 'database',
  status: 'ok',
  title: 'Database',
  detail: 'The database file passed the quick integrity check.',
  fix: null,
  ...over,
});
const report = (checks: object[] = [check()], u: object = update()) => ({ checks, update: u });

describe('health page', () => {
  it('lists each check with its status in words, what was found and what to do', async () => {
    const { calls } = renderApp(
      {
        ...signedIn(),
        'GET /health/checks': () => ({
          body: report([
            check(),
            check({
              id: 'disk',
              status: 'warn',
              title: 'Free disk space',
              detail: '1.2 GB free on the volume that holds your data.',
              fix: 'Free space on the server.',
            }),
            check({
              id: 'backup',
              status: 'fail',
              title: 'Backups',
              detail: 'No backup yet.',
              fix: 'Open Backups.',
            }),
          ]),
        }),
      },
      '/settings/health',
    );
    const list = await screen.findByRole('list', { name: 'Health checks' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toMatch(/Database.*OK/);
    expect(rows[1]!.textContent).toMatch(
      /Free disk space.*Warning.*1\.2 GB free.*Free space on the server\./,
    );
    expect(rows[2]!.textContent).toMatch(/Backups.*Problem.*Open Backups\./);
    // The page sends its own clock, in milliseconds, for the server's clock check.
    const read = calls.find((c) => c.path === '/health/checks')!;
    expect(Number(new URLSearchParams(read.query).get('client_time'))).toBeGreaterThan(
      1_700_000_000_000,
    );
  });

  it('says what it cannot see and points at infra/doctor.sh', async () => {
    renderApp(
      { ...signedIn(), 'GET /health/checks': () => ({ body: report() }) },
      '/settings/health',
    );
    expect(await screen.findByText('What this page cannot see')).toBeTruthy();
    expect(screen.getByText('infra/doctor.sh')).toBeTruthy();
    const link = screen.getByRole('link', { name: /Troubleshooting/ });
    expect(link.getAttribute('href')).toBe('/help/troubleshooting');
  });

  it('Check now asks the server and reports a newer version', async () => {
    let u = update();
    const { calls } = renderApp(
      {
        ...signedIn(),
        'GET /health/checks': () => ({ body: report([check()], u) }),
        'POST /health/update-check': () => {
          u = newer;
          return { body: u };
        },
      },
      '/settings/health',
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Check now' }));
    expect(await screen.findByText('Version 0.4.0 is available.')).toBeTruthy();
    expect(
      calls.filter((c) => c.method === 'POST' && c.path === '/health/update-check'),
    ).toHaveLength(1);
  });

  it('Check now says so when the check did not work', async () => {
    renderApp(
      {
        ...signedIn(),
        'GET /health/checks': () => ({ body: report() }),
        'POST /health/update-check': () => ({ body: update({ check_failed: true }) }),
      },
      '/settings/health',
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Check now' }));
    expect(await screen.findByText(/The check did not work/)).toBeTruthy();
  });
});

describe('updates switch', () => {
  it('is on by default and saves at once', async () => {
    const { calls } = renderApp(
      {
        ...signedIn(),
        'GET /health/checks': () => ({ body: report() }),
        'PATCH /settings': ({ body }) => ({ body: settingsFixture(body as object) }),
      },
      '/settings/updates',
    );
    const toggle = await screen.findByRole('switch', { name: 'Check for new versions' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        update_check_enabled: false,
      }),
    );
  });

  it('says what is sent: nothing about you', async () => {
    renderApp(
      { ...signedIn(), 'GET /health/checks': () => ({ body: report() }) },
      '/settings/updates',
    );
    expect(await screen.findByText(/It sends nothing\s+about you/)).toBeTruthy();
  });
});

describe('navigation dot', () => {
  it('shows on Settings while a check is not ok', async () => {
    renderApp({
      ...signedIn(),
      'GET /health/checks': () => ({ body: report([check({ status: 'warn', fix: 'Do it.' })]) }),
    });
    expect(await screen.findByTestId('attention-dot')).toBeTruthy();
    const settings = screen.getByRole('link', { name: /Settings/ });
    expect(settings.textContent).toMatch(/Needs attention/);
  });

  it('is absent when everything is ok, and while the checks cannot be read', async () => {
    renderApp({ ...signedIn(), 'GET /health/checks': () => ({ body: report() }) });
    await screen.findByRole('navigation', { name: 'Main' });
    await waitFor(() => expect(screen.queryByTestId('attention-dot')).toBeNull());
    cleanup();
    renderApp({
      ...signedIn(),
      'GET /health/checks': () => ({ status: 500, body: { code: 'internal_error' } }),
    });
    await screen.findByRole('navigation', { name: 'Main' });
    expect(screen.queryByTestId('attention-dot')).toBeNull();
  });
});

describe('update banner', () => {
  const open = (u: object = newer) =>
    renderApp(
      { ...signedIn(), 'GET /health/checks': () => ({ body: report([check()], u) }) },
      '/dashboard',
    );

  beforeEach(() => localStorage.clear());

  it('names the version, opens the release page in a new tab and shows the command', async () => {
    open();
    const banner = await screen.findByRole('region', { name: 'Version 0.4.0 is available' });
    const whatsNew = within(banner).getByRole('link', { name: "What's new" });
    expect(whatsNew.getAttribute('href')).toBe(
      'https://github.com/raiz-toff/Milewage/releases/tag/v0.4.0',
    );
    expect(whatsNew.getAttribute('target')).toBe('_blank');
    expect(whatsNew.getAttribute('rel')).toContain('noopener');
    expect(within(banner).getByText('./infra/upgrade.sh')).toBeTruthy();
    expect(banner.textContent).toMatch(/cannot upgrade itself/);
    // No button upgrades anything from here.
    expect(
      within(banner).queryByRole('button', { name: /upgrade now|update now|install/i }),
    ).toBeNull();
  });

  it('copies the command', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Copy command' }));
    expect(writeText).toHaveBeenCalledWith('./infra/upgrade.sh');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('is not there when the server is on the newest version', async () => {
    open(update());
    await screen.findByRole('navigation', { name: 'Main' });
    await waitFor(() => expect(screen.queryByText(/is available/)).toBeNull());
  });

  it('is dismissed per version and stays dismissed', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Version 0.4.0 is available')).toBeNull();
    expect(localStorage.getItem('milewage.update-dismissed')).toBe('0.4.0');
    cleanup();
    open();
    await screen.findByRole('navigation', { name: 'Main' });
    expect(screen.queryByText('Version 0.4.0 is available')).toBeNull();
    cleanup();
    // A still newer version is a new banner.
    open(update({ ...newer, latest_version: '0.5.0' }));
    expect(await screen.findByText('Version 0.5.0 is available')).toBeTruthy();
  });

  it('survives storage that throws', async () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Version 0.4.0 is available')).toBeNull();
  });
});
