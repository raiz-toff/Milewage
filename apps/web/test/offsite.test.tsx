// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Modules } from '../src/api/client';
import { renderApp, settingsFixture, signedIn } from './support/kit';
import type { Handler } from './support/kit';

afterEach(cleanup);

const DAY = 86_400_000;
const backup = {
  id: 4,
  created_at: 1_700_000_000_000,
  size_bytes: 2_500_000,
  sha256: 'ab',
  integrity_ok: true,
  trigger: 'nightly',
};
const status = (offsite: object) => ({
  app_version: '0.1.0',
  schema_version: 7,
  sqlite_version: '3.52.0',
  db_bytes: 4_000_000,
  wal_bytes: 0,
  disk_free_bytes: 50_000_000_000,
  disk_state: 'ok',
  last_backup: null,
  offsite: { last_download_at: null, synced_elsewhere_at: null, reminder_due: false, ...offsite },
  paired_device_count: 1,
  mode: 'normal',
});

function open(offsite: object, modules: Partial<Modules>, extra: Record<string, Handler> = {}) {
  return renderApp(
    {
      ...signedIn(settingsFixture({ modules })),
      'GET /backups': () => ({ body: [backup] }),
      'GET /system/status': () => ({ body: status(offsite) }),
      ...extra,
    },
    '/backups',
  );
}

describe('off-site copy control (backup download module)', () => {
  it('shows the last download and an unticked switch before anything is confirmed', async () => {
    open({ last_download_at: 1_700_000_000_000 }, { backup_download: true });
    const section = await screen.findByRole('region', { name: 'Off-site copy' });
    expect(section.textContent).toContain('Last download: Nov 14, 2023');
    const box = screen.getByRole('checkbox', {
      name: 'My backup folder is copied to another place',
    }) as HTMLInputElement;
    expect(box.checked).toBe(false);
  });

  it('ticking sends synced_elsewhere true and shows the confirmation', async () => {
    const { calls } = open(
      {},
      { backup_download: true },
      {
        'PUT /backups/offsite-ack': () => ({
          body: { last_download_at: null, synced_elsewhere_at: Date.now(), reminder_due: false },
        }),
      },
    );
    fireEvent.click(await screen.findByRole('checkbox'));
    expect(await screen.findByText(/You will be asked again after 90 days/)).toBeTruthy();
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ synced_elsewhere: true });
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });

  it('unticking clears it', async () => {
    const { calls } = open(
      { synced_elsewhere_at: Date.now() - DAY },
      { backup_download: true },
      {
        'PUT /backups/offsite-ack': () => ({
          body: { last_download_at: null, synced_elsewhere_at: null, reminder_due: true },
        }),
      },
    );
    const box = (await screen.findByRole('checkbox')) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    await screen.findByRole('status');
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ synced_elsewhere: false });
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });

  it('a confirmation over 90 days old asks to be ticked again', async () => {
    open(
      { synced_elsewhere_at: Date.now() - 91 * DAY, reminder_due: true },
      { backup_download: true },
    );
    expect(await screen.findByText(/over 90 days ago/)).toBeTruthy();
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });

  it('a download click clears the reminder on screen', async () => {
    open({ reminder_due: true }, { backup_download: true });
    expect(await screen.findByText(/No copy of your backups has left this server/)).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Download' }));
    expect(screen.queryByText(/No copy of your backups has left this server/)).toBeNull();
    expect(screen.getByText(/Last download: just now/)).toBeTruthy();
  });

  it('shows a refusal from the server', async () => {
    open(
      {},
      { backup_download: true },
      {
        'PUT /backups/offsite-ack': () => ({ status: 404, body: { code: 'not_found' } }),
      },
    );
    fireEvent.click(await screen.findByRole('checkbox'));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('module off: no off-site control and no download link, but the page still works', async () => {
    const { calls } = open({}, { backup_download: false });
    expect(await screen.findByText('nightly')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Off-site copy' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Download' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Back up now' })).toBeTruthy();
    expect(calls.some((c) => c.path.includes('offsite'))).toBe(false);
  });
});
