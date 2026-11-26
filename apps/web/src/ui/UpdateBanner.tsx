import { useId, useState } from 'react';
import { InfoIcon } from '@/ui/icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { HelpLink } from '../help/HelpLink';
import { useHealth } from '../api/health';

/** The command that upgrades a self-hosted install, run in the MileWage folder on the server. */
export const UPGRADE_COMMAND = './infra/upgrade.sh';

const KEY = 'milewage.update-dismissed';

/** The version whose banner was dismissed on this browser; storage may be blocked, so never throw. */
function dismissedVersion(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** A newer version is out: what it is, where to read about it, and the one command that upgrades. */
export function UpdateBanner() {
  const { data } = useHealth();
  const [dismissed, setDismissed] = useState(dismissedVersion);
  const [copied, setCopied] = useState(false);
  const title = useId();
  const update = data?.update;
  // Dismissal is per version: a still newer release shows the banner again.
  if (!update?.available || !update.latest_version || dismissed === update.latest_version) {
    return null;
  }
  const version = update.latest_version;

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, version);
    } catch {
      // Blocked storage: the banner goes for this visit and comes back on the next.
    }
    setDismissed(version);
  };
  const copy = () => {
    void navigator.clipboard?.writeText(UPGRADE_COMMAND).then(
      () => setCopied(true),
      () => undefined,
    );
  };

  return (
    <Alert role="region" aria-labelledby={title} className="mb-4">
      <InfoIcon />
      <AlertTitle id={title}>Version {version} is available</AlertTitle>
      <AlertDescription>
        <p>
          You run {update.current_version}. MileWage cannot upgrade itself: upgrading is one command
          on the computer that runs your server. Open a terminal in the MileWage folder there and
          run:
        </p>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <code className="rounded-small bg-muted px-3 py-2 font-mono text-body-medium text-on-surface">
            {UPGRADE_COMMAND}
          </code>
          <Button type="button" variant="outline" size="sm" onClick={copy}>
            {copied ? 'Copied' : 'Copy command'}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="tonal" size="sm" asChild>
            <a href={update.notes_url} target="_blank" rel="noopener noreferrer">
              What&apos;s new
            </a>
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
            Dismiss
          </Button>
          <HelpLink page="health-and-updates">How upgrading works</HelpLink>
        </div>
      </AlertDescription>
    </Alert>
  );
}
