// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp, settingsFixture, signedIn } from './support/kit';

afterEach(cleanup);

const backup = (over: object = {}) => ({
  id: 1,
  created_at: 1_700_000_000_000,
  size_bytes: 2_500_000,
  sha256: 'ab',
  integrity_ok: true,
  trigger: 'nightly',
  ...over,
});
const status = (over: object = {}) => ({
  app_version: '0.1.0',
  schema_version: 7,
  sqlite_version: '3.52.0',
  db_bytes: 4_000_000,
  wal_bytes: 0,
  disk_free_bytes: 50_000_000_000,
  disk_state: 'ok',
  last_backup: null,
  last_backup_failure: null,
  offsite: { last_download_at: null, synced_elsewhere_at: null, reminder_due: false },
  paired_device_count: 1,
  mode: 'normal',
  ...over,
});

function open(list = [backup()], st = status(), modules = {}) {
  let items = list;
  return renderApp(
    {
      ...signedIn(settingsFixture({ modules })),
      'GET /backups': () => ({ body: items }),
      'GET /system/status': () => ({ body: st }),
      'POST /backups': () => {
        items = [backup({ id: 2, trigger: 'manual' }), ...items];
        return { status: 201, body: items[0] };
      },
    } as never,
    '/backups',
  );
}

describe('backups page', () => {
  it('lists backups with kind, size and the verification result', async () => {
    open([backup(), backup({ id: 2, integrity_ok: false, trigger: 'pre_migration' })]);
    expect(await screen.findByText('nightly')).toBeTruthy();
    expect(screen.getByText('before an upgrade')).toBeTruthy();
    expect(screen.getByText('FAILED')).toBeTruthy();
    expect(screen.getByText('passed')).toBeTruthy();
  });

  it('shows an empty state', async () => {
    open([]);
    expect(await screen.findByText('No backup has been made yet.')).toBeTruthy();
  });

  it('Back up now runs a backup and reads the list back', async () => {
    const { calls } = open();
    await screen.findByText('nightly');
    fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));
    expect(await screen.findByText('manual')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/backups')).toHaveLength(1);
  });

  it('shows the 15 minute limit as the server states it', async () => {
    renderApp(
      {
        ...signedIn(),
        'GET /backups': () => ({ body: [] }),
        'GET /system/status': () => ({ body: status() }),
        'POST /backups': () => ({
          status: 429,
          body: { code: 'rate_limited', detail: 'Too many backups.' },
          headers: { 'Retry-After': '600' },
        }),
      } as never,
      '/backups',
    );
    await screen.findByText('No backup has been made yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Too many backups. Try again in 600 s.',
    );
  });

  it('warns about low disk, read-only mode and a due off-site copy', async () => {
    open(
      [backup()],
      status({
        disk_state: 'backup_skipped',
        mode: 'read_only',
        offsite: { last_download_at: null, synced_elsewhere_at: null, reminder_due: true },
      }),
    );
    expect(await screen.findByText(/too low to make a backup/)).toBeTruthy();
    expect(screen.getByText(/read-only after a failed upgrade/)).toBeTruthy();
    expect(screen.getByText(/Download one and keep it elsewhere/)).toBeTruthy();
  });

  it('shows no warning when everything is fine', async () => {
    open();
    await screen.findByText('nightly');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert', { name: 'The last backup failed' })).toBeNull();
  });

  it('says when the last backup failed and why, until a backup succeeds', async () => {
    let st = status({
      last_backup_failure: {
        // 22:00 in Toronto.
        at: Date.parse('2027-01-15T03:00:00Z'),
        message: 'Not enough free disk space for a backup (it needs twice the database size).',
      },
    });
    renderApp(
      {
        ...signedIn(),
        'GET /backups': () => ({ body: [backup()] }),
        'GET /system/status': () => ({ body: st }),
        'POST /backups': () => {
          st = status();
          return { status: 201, body: backup({ id: 2, trigger: 'manual' }) };
        },
      } as never,
      '/backups',
    );
    const alert = await screen.findByRole('alert', { name: 'The last backup failed' });
    expect(alert.textContent).toContain(
      'It failed on Jan 14, 2027, 22:00. The server said: Not enough free disk space for a backup (it needs twice the database size).',
    );
    expect(alert.textContent).toContain('Older backups are kept. Try Back up now.');
    fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));
    await waitFor(() =>
      expect(screen.queryByRole('alert', { name: 'The last backup failed' })).toBeNull(),
    );
  });

  it('download link is absent when modules.backup_download is off, present when on', async () => {
    open([backup()], status(), { backup_download: false });
    await screen.findByText('nightly');
    expect(screen.queryByRole('link', { name: 'Download' })).toBeNull();
    cleanup();
    open([backup()], status(), { backup_download: true });
    const link = await screen.findByRole('link', { name: 'Download' });
    expect(link.getAttribute('href')).toBe('/api/v1/backups/1/download');
  });
});

describe('a new recovery key', () => {
  const KEY = 'AGE-SECRET-KEY-1NEWKEY0000000000000000000000000000000000000000ABCDEF';
  function openKey(
    confirmed: { backup: unknown } = { backup: backup({ id: 9, trigger: 'manual' }) },
  ) {
    let items = [backup()];
    return renderApp(
      {
        ...signedIn(),
        'GET /backups': () => ({ body: items }),
        'GET /system/status': () => ({ body: status() }),
        'POST /backups/recovery-key': ({ body }: { body: { password: string } }) =>
          body.password === 'right password'
            ? { status: 201, body: { recovery_key: KEY, state: 'needs_confirmation' } }
            : {
                status: 401,
                body: { code: 'invalid_credentials', detail: 'The password is wrong.' },
              },
        'POST /backups/recovery-key/confirm': ({ body }: { body: { last6: string } }) => {
          if (body.last6.toUpperCase() !== 'ABCDEF') {
            return {
              status: 422,
              body: { code: 'validation_failed', detail: 'That is not the end of the new key.' },
            };
          }
          if (confirmed.backup) items = [confirmed.backup as ReturnType<typeof backup>, ...items];
          return { body: { state: 'ready', ...confirmed } };
        },
      } as never,
      '/backups',
    );
  }
  const start = async () => {
    await screen.findByText('nightly');
    fireEvent.click(screen.getByRole('button', { name: 'Make a new recovery key' }));
    return screen.findByRole('dialog');
  };

  it('asks for the password and says older backups still need the old key', async () => {
    const { calls } = openKey();
    const dialog = await start();
    expect(dialog.textContent).toContain('Backups made before today still need the old key');
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'wrong one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make the new key' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The password is wrong.');
    expect(screen.queryByTestId('new-recovery-key')).toBeNull();
    expect(calls.find((c) => c.path === '/backups/recovery-key')?.body).toEqual({
      password: 'wrong one',
    });
  });

  it('shows the key once, confirms its end and lists the first backup under it', async () => {
    const { calls } = openKey();
    await start();
    fireEvent.change(screen.getByLabelText('Your password'), {
      target: { value: 'right password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Make the new key' }));
    expect((await screen.findByTestId('new-recovery-key')).textContent).toBe(KEY);
    const saved = screen.getByRole('button', { name: 'I saved it' }) as HTMLButtonElement;
    expect(saved.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Last 6 characters of the key'), {
      target: { value: 'zzzzzz' },
    });
    fireEvent.click(saved);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That is not the end of the new key.',
    );
    fireEvent.change(screen.getByLabelText('Last 6 characters of the key'), {
      target: { value: 'abcdef' },
    });
    fireEvent.click(saved);
    expect(await screen.findByText('New recovery key in use')).toBeTruthy();
    expect(screen.getByText(/A backup with it was made just now/)).toBeTruthy();
    expect(screen.queryByTestId('new-recovery-key')).toBeNull();
    expect(await screen.findByText('manual')).toBeTruthy();
    const sent = calls.filter((c) => c.path === '/backups/recovery-key/confirm');
    expect(sent.map((c) => c.body)).toEqual([{ last6: 'zzzzzz' }, { last6: 'abcdef' }]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('says so when the first backup under the new key failed', async () => {
    openKey({ backup: null });
    await start();
    fireEvent.change(screen.getByLabelText('Your password'), {
      target: { value: 'right password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Make the new key' }));
    await screen.findByTestId('new-recovery-key');
    fireEvent.change(screen.getByLabelText('Last 6 characters of the key'), {
      target: { value: 'ABCDEF' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'I saved it' }));
    expect(await screen.findByText(/the first backup with it failed/)).toBeTruthy();
  });
});

describe('restore onto a fresh instance', () => {
  const fresh = (restore: () => { status?: number; body?: unknown }) =>
    renderApp({
      'GET /setup/status': () => ({ body: { state: 'needs_setup' } }),
      'POST /setup/restore': restore,
    } as never);

  it('uploads the file and the key as multipart and shows the counts', async () => {
    const { calls } = fresh(() => ({
      body: {
        integrity_ok: true,
        schema_version: 7,
        shift_count: 12,
        stop_label_count: 3,
        point_count: 4500,
      },
    }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore from a backup instead' }));
    const file = new File(['x'], 'b.db.gz.age');
    fireEvent.change(screen.getByLabelText(/Backup file/), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText(/Recovery key/), {
      target: { value: 'AGE-SECRET-KEY-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('Shifts: 12')).toBeTruthy();
    expect(screen.getByText('Recorded points: 4500')).toBeTruthy();
    const sent = calls.find((c) => c.path === '/setup/restore');
    expect(sent?.contentType).toContain('multipart/form-data');
  });

  it('shows a refused key and stays on the form', async () => {
    fresh(() => ({
      status: 422,
      body: { code: 'invalid_recovery_key', detail: 'That key does not open this backup.' },
    }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore from a backup instead' }));
    fireEvent.change(screen.getByLabelText(/Backup file/), {
      target: { files: [new File(['x'], 'b.age')] },
    });
    fireEvent.change(screen.getByLabelText(/Recovery key/), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('does not open'));
    expect(screen.getByLabelText(/Recovery key/)).toBeTruthy();
  });

  it('is offered only on a fresh instance: a ready server has no restore entry', async () => {
    renderApp(signedIn() as never);
    await screen.findByRole('navigation', { name: 'Main' });
    expect(screen.queryByRole('button', { name: /Restore from a backup/ })).toBeNull();
  });
});
