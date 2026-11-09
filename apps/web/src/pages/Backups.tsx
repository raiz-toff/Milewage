import { useState } from 'react';
import { DatabaseBackup } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState, PageHeader, Section, StatCard, TableBox, tableClass } from '../ui/layout';
import { errorText, put, useApiQuery, useChange } from '../api/query';
import type { Schemas } from '../api/client';
import { formatDateTime } from '../format';
import { useSettings } from '../session';
import { Button, FormError } from '../ui/form';
import { NewRecoveryKey } from './NewRecoveryKey';

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
  const { timezone, modules } = useSettings();
  const list = useApiQuery('/backups');
  const system = useApiQuery('/system/status');
  // Both or neither, so the warnings and the list appear together.
  const both = list.data && system.data;
  const backups = both ? list.data! : null;
  const status = both ? system.data! : null;
  const change = useChange();
  const { busy } = change;
  const error = errorText(change, list, system);
  // The server resets the reminder when a file is handed out; show that without a reload.
  const [downloaded, setDownloaded] = useState(false);

  const run = () => change.run((api) => api.POST('/backups'));

  async function acknowledge(synced: boolean) {
    const done = await change.run(
      (api) => api.PUT('/backups/offsite-ack', { body: { synced_elsewhere: synced } }),
      // The answer is the status's offsite part: shown at once, not asked for again.
      (offsite) => [put('/system/status', undefined, (old) => old && { ...old, offsite })],
    );
    if (done) setDownloaded(false);
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
      <PageHeader
        title="Backups"
        description="A backup can be made once every 15 minutes. Each one is checked after it is written."
      >
        <Button type="button" busy={busy} onClick={() => void run()}>
          <DatabaseBackup />
          Back up now
        </Button>
      </PageHeader>
      {warnings.map((w) => (
        <p
          key={w}
          role="status"
          className="rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm"
        >
          {w}
        </p>
      ))}
      <FormError message={error} />
      {status ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Version" value={status.app_version} />
          <StatCard label="Database" value={mb(status.db_bytes + status.wal_bytes)} />
          <StatCard label="Free disk" value={mb(status.disk_free_bytes)} />
          <StatCard label="Paired phones" value={status.paired_device_count} />
        </div>
      ) : null}
      <Section title="Backups on this server">
        {backups === null ? (
          <p className="text-sm text-muted-foreground">Loading</p>
        ) : backups.length === 0 ? (
          <EmptyState>No backup has been made yet.</EmptyState>
        ) : (
          <TableBox>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Kind</th>
                  <th>Size</th>
                  <th>Check</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.id} className="border-t border-border">
                    <td className="py-2 pr-4 tabular-nums text-sm">
                      {formatDateTime(b.created_at, timezone)}
                    </td>
                    <td className="pr-4 text-muted-foreground">{TRIGGER[b.trigger]}</td>
                    <td className="pr-4 text-muted-foreground">{mb(b.size_bytes)}</td>
                    <td>
                      {b.integrity_ok ? (
                        <Badge variant="secondary">passed</Badge>
                      ) : (
                        <Badge variant="destructive">FAILED</Badge>
                      )}
                    </td>
                    <td className="text-right">
                      {modules.backup_download ? (
                        <a
                          className="font-medium underline decoration-primary decoration-2 underline-offset-4"
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
          </TableBox>
        )}
      </Section>
      {status && modules.backup_download ? (
        <Offsite offsite={status.offsite} downloaded={downloaded} onChange={acknowledge} />
      ) : null}
      <NewRecoveryKey />
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
    <Section label="Off-site copy" title="Off-site copy">
      <p className="text-sm text-muted-foreground">
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
          className="size-4 accent-primary"
          checked={at !== null && !stale}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>My backup folder is copied to another place</span>
      </label>
      {at !== null ? (
        <p className="text-sm text-muted-foreground">
          {stale
            ? `Confirmed ${formatDateTime(at, timezone)}. That is over 90 days ago: tick the box again if it is still true.`
            : `Confirmed ${formatDateTime(at, timezone)}. You will be asked again after 90 days.`}
        </p>
      ) : null}
    </Section>
  );
}
