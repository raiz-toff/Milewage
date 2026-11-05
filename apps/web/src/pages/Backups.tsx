import { useCallback, useEffect, useState } from 'react';
import { describe, unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { formatDateTime } from '../format';
import { useSession, useSettings } from '../session';
import { Button, FormError } from '../ui/form';

type Backup = Schemas['Backup'];
type Status = Schemas['SystemStatus'];

const TRIGGER: Record<Backup['trigger'], string> = {
  nightly: 'nightly',
  shift_end: 'after a shift',
  manual: 'manual',
  pre_migration: 'before an upgrade',
  pre_restore: 'before a restore',
};

const DISK: Record<Status['disk_state'], string | null> = {
  ok: null,
  warning: 'Disk space is getting low.',
  backup_skipped: 'Disk space is too low to make a backup. Free some space.',
  writes_blocked: 'The disk is almost full. New data is refused until space is freed.',
};

const DAY = 86_400_000;

const mb = (n: number) => `${(n / 1_000_000).toFixed(1)} MB`;

/**
 * Backups (10 sections 4 and 11): the list with the result of each verification, "Back up now",
 * the instance status and the warnings that go with it. The backup engine is core and never
 * toggled; only the download link follows `modules.backup_download`.
 */
export function Backups() {
  const { api } = useSession();
  const { timezone, modules } = useSettings();
  const [backups, setBackups] = useState<Backup[] | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The server resets the reminder when a file is handed out; show that without a reload.
  const [downloaded, setDownloaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [b, s] = await Promise.all([
        unwrap(api.GET('/backups')),
        unwrap(api.GET('/system/status')),
      ]);
      setBackups(b);
      setStatus(s);
    } catch (e) {
      setError(describe(e));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await unwrap(api.POST('/backups'));
      await load();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  async function acknowledge(synced: boolean) {
    setError(null);
    try {
      const offsite = await unwrap(
        api.PUT('/backups/offsite-ack', { body: { synced_elsewhere: synced } }),
      );
      setStatus((old) => (old ? { ...old, offsite } : old));
      setDownloaded(false);
    } catch (e) {
      setError(describe(e));
    }
  }

  const warnings = status
    ? [
        DISK[status.disk_state],
        status.mode === 'read_only'
          ? 'The server is read-only after a failed upgrade. Nothing can be saved.'
          : null,
        status.mode === 'restoring' ? 'A restore is running.' : null,
        status.offsite.reminder_due && !downloaded
          ? 'No copy of your backups has left this server recently. Download one and keep it elsewhere.'
          : null,
      ].filter((w): w is string => w !== null)
    : [];

  return (
    <section className="space-y-6">
      <h1 className="font-heading text-2xl">Backups</h1>
      {warnings.map((w) => (
        <p key={w} role="status" className="rounded border border-line bg-card p-3 text-sm">
          {w}
        </p>
      ))}
      <div className="space-y-3 rounded border border-line bg-card p-4">
        <Button type="button" busy={busy} onClick={() => void run()}>
          Back up now
        </Button>
        <p className="text-sm text-muted">
          A backup can be made once every 15 minutes. Each one is checked after it is written.
        </p>
        <FormError message={error} />
      </div>
      {backups === null ? (
        <p className="text-muted">Loading</p>
      ) : backups.length === 0 ? (
        <p className="text-muted">No backup has been made yet.</p>
      ) : (
        <table className="w-full text-left">
          <thead className="text-sm text-muted">
            <tr>
              <th className="pb-2 font-normal">When</th>
              <th className="font-normal">Kind</th>
              <th className="font-normal">Size</th>
              <th className="font-normal">Check</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.id} className="border-t border-line">
                <td className="py-2 pr-4 font-mono text-sm">
                  {formatDateTime(b.created_at, timezone)}
                </td>
                <td className="pr-4 text-muted">{TRIGGER[b.trigger]}</td>
                <td className="pr-4 text-muted">{mb(b.size_bytes)}</td>
                <td className="pr-4">{b.integrity_ok ? 'passed' : 'FAILED'}</td>
                <td className="text-right">
                  {modules.backup_download ? (
                    <a
                      className="text-accent"
                      href={`/api/v1/backups/${b.id}/download`}
                      onClick={() => setDownloaded(true)}
                    >
                      Download
                    </a>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {status && modules.backup_download ? (
        <Offsite offsite={status.offsite} downloaded={downloaded} onChange={acknowledge} />
      ) : null}
      {status ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-muted">Version</dt>
          <dd>{status.app_version}</dd>
          <dt className="text-muted">Database</dt>
          <dd>{mb(status.db_bytes + status.wal_bytes)}</dd>
          <dt className="text-muted">Free disk</dt>
          <dd>{mb(status.disk_free_bytes)}</dd>
          <dt className="text-muted">Paired phones</dt>
          <dd>{status.paired_device_count}</dd>
        </dl>
      ) : null}
    </section>
  );
}

/**
 * The off-site copy (10 section 4): the last download, and a switch for a driver whose backup
 * folder is synced somewhere else already. The switch is re-asked after 90 days.
 */
function Offsite({
  offsite,
  downloaded,
  onChange,
}: {
  offsite: Status['offsite'];
  downloaded: boolean;
  onChange: (synced: boolean) => void;
}) {
  const { timezone } = useSettings();
  const at = offsite.synced_elsewhere_at;
  const stale = at !== null && Date.now() - at > 90 * DAY;
  return (
    <section
      aria-label="Off-site copy"
      className="space-y-2 rounded border border-line bg-card p-4"
    >
      <h2 className="font-heading text-lg">Off-site copy</h2>
      <p className="text-sm text-muted">
        Last download:{' '}
        {downloaded
          ? 'just now'
          : offsite.last_download_at === null
            ? 'never'
            : formatDateTime(offsite.last_download_at, timezone)}
      </p>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={at !== null && !stale}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>My backup folder is synced to another place</span>
      </label>
      {at !== null ? (
        <p className="text-sm text-muted">
          {stale
            ? `Confirmed ${formatDateTime(at, timezone)}. That is over 90 days ago: tick the box again if it is still true.`
            : `Confirmed ${formatDateTime(at, timezone)}. You will be asked again after 90 days.`}
        </p>
      ) : null}
    </section>
  );
}
