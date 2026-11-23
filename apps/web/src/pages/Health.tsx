import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useHealth } from '../api/health';
import type { HealthReport } from '../api/health';
import { errorText, useChange } from '../api/query';
import { formatDateTime } from '../format';
import { HelpLink } from '../help/HelpLink';
import { settingsPatch, useSettings } from '../session';
import { Button, FormError, PrivacyLink } from '../ui/form';

type Check = HealthReport['checks'][number];

const WORD: Record<Check['status'], string> = { ok: 'OK', warn: 'Warning', fail: 'Problem' };
const BADGE: Record<Check['status'], 'secondary' | 'outline' | 'destructive'> = {
  ok: 'secondary',
  warn: 'outline',
  fail: 'destructive',
};

/**
 * What the server can check from inside its own container, one row each, and a button to look for
 * a new version now. Docker, ports and Tailscale live outside the container: the page says so and
 * points at `infra/doctor.sh` instead of guessing.
 */
export function HealthSection() {
  const { timezone, time_format: tf } = useSettings();
  const health = useHealth();
  const change = useChange();
  const [note, setNote] = useState<string | null>(null);
  const error = errorText(change, health);
  const update = health.data?.update;

  async function checkNow() {
    setNote(null);
    const done = await change.run((api) => api.POST('/health/update-check'));
    if (!done) return;
    const u = done.data;
    setNote(
      u.check_failed
        ? 'The check did not work. The update check above says why.'
        : u.available
          ? `Version ${u.latest_version} is available.`
          : 'You run the newest version.',
    );
  }

  return (
    <div className="space-y-4">
      <FormError message={error} />
      <Card className="py-0">
        {health.data ? (
          <ul aria-label="Health checks" className="divide-y divide-outline-variant">
            {health.data.checks.map((c) => (
              <li key={c.id} className="space-y-1 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-title-small text-on-surface">{c.title}</h3>
                  <Badge variant={BADGE[c.status]}>{WORD[c.status]}</Badge>
                </div>
                <p className="text-body-medium text-on-surface-variant">{c.detail}</p>
                {c.fix ? <p className="text-body-medium text-on-surface">{c.fix}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-body-medium text-muted-foreground">
            {health.isError ? 'The checks could not be read.' : 'Loading'}
          </p>
        )}
      </Card>
      <Card>
        <CardContent className="space-y-3">
          <h3 className="text-title-medium text-on-surface">Look for a new version</h3>
          <p className="text-body-medium text-muted-foreground">
            {update?.checked_at
              ? `The last check that worked was on ${formatDateTime(update.checked_at, timezone, tf)}.`
              : 'No check has worked yet.'}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="tonal"
              busy={change.busy}
              onClick={() => void checkNow()}
            >
              Check now
            </Button>
            {note ? (
              <p role="status" className="text-body-medium text-muted-foreground">
                {note}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-2">
          <h3 className="text-title-medium text-on-surface">What this page cannot see</h3>
          <p className="text-body-medium text-muted-foreground">
            MileWage runs in a container and cannot see the computer around it: Docker itself, the
            ports, Tailscale, the home address. To check those, run <code>infra/doctor.sh</code> on
            the server computer. It prints one line for each and the next step.
          </p>
          <HelpLink page="troubleshooting">Troubleshooting</HelpLink>
        </CardContent>
      </Card>
    </div>
  );
}

/** The owner's switch for the daily look at GitHub's releases; saved at once, kept on the server. */
export function UpdatesSection() {
  const saved = useSettings();
  const change = useChange();
  const on = saved.update_check_enabled;
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-6">
          <div className="space-y-1">
            <label htmlFor="update-check" className="text-body-large">
              Check for new versions
            </label>
            <p className="text-body-medium text-muted-foreground">
              Once a day your server asks GitHub for the newest MileWage release. It sends nothing
              about you or your data, and it only reads the public release list. When a newer
              version exists, a banner tells you. MileWage never upgrades itself: you run the
              upgrade command on the server.
            </p>
          </div>
          <Switch
            id="update-check"
            checked={on}
            disabled={change.busy}
            onCheckedChange={(next) =>
              void change.run(...settingsPatch({ update_check_enabled: next }))
            }
          />
        </div>
        <FormError message={errorText(change)} />
        <p className="text-body-medium text-muted-foreground">
          What leaves your server, and when:{' '}
          <PrivacyLink className="font-medium text-foreground underline" />.
        </p>
      </CardContent>
    </Card>
  );
}
