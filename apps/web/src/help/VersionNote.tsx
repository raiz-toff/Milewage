import { useState } from 'react';
import { InfoIcon } from '@/ui/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useApiQuery } from '../api/query';
import { useUpdate } from '../pwa/update';
import { githubUrl } from './source';

/**
 * When the server runs another version than these pages describe (spec Q15): an old app shell
 * still served by the service worker (Reload fixes it), or a web image and a server image of
 * different versions (the upgrade guide fixes it). Asks only the owner's own server; when it does
 * not answer, says nothing.
 */
export function VersionNote({ version }: { version: string }) {
  const status = useApiQuery('/system/status');
  const { ready, reload } = useUpdate();
  const [busy, setBusy] = useState(false);
  const server = status.data?.app_version;
  if (!server || server === version) return null;
  return (
    <Alert role="note">
      <InfoIcon aria-hidden />
      <AlertDescription className="space-y-3 text-foreground">
        <p>
          Your server runs MileWage {server}. These pages describe {version}.
        </p>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            // A waiting service worker takes over and reloads; without one, reload the page.
            if (ready) reload();
            else window.location.reload();
          }}
        >
          {busy ? 'Reloading' : 'Reload'}
        </Button>
        <p className="text-muted-foreground">
          If it stays after a reload, update both parts as the{' '}
          <a
            href={githubUrl('infra/docs/upgrade.md', version)}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground underline underline-offset-4"
          >
            upgrade guide
          </a>{' '}
          says.
        </p>
      </AlertDescription>
    </Alert>
  );
}
