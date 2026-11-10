import { useState } from 'react';
import { CloseIcon, DownloadIcon } from '@/ui/icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cardShows, dismissInstallCard, promptInstall, useInstall } from './install';
import type { InstallState } from './install';

/** The browser's own steps, for browsers that install from their menu (plan 27 section 3). */
const STEPS: Partial<Record<InstallState, string>> = {
  ios: 'Tap Share, then Add to Home Screen.',
  'safari-mac': "In Safari's menu bar, choose File, then Add to Dock.",
  'firefox-android': 'Open the menu (⋮), then choose Add app to Home screen.',
};

function InstallButton({ size }: { size?: 'sm' }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="tonal"
      size={size}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await promptInstall();
        setBusy(false);
      }}
    >
      <DownloadIcon />
      Install
    </Button>
  );
}

/**
 * "Install MileWage" in the sidebar footer, above Devices and Settings: only where one click or one short
 * step installs, never in the installed app, gone for good after "Not now" (web.dev, promoting
 * installation: offer it where people look, never on load, remember a no).
 */
export function InstallCard() {
  const { state, dismissed } = useInstall();
  if (!cardShows(state, dismissed)) return null;
  return (
    // The drawer is the page's own colour, so a plain card stands on it as it does on a page.
    <Card
      size="sm"
      role="region"
      aria-label="Install MileWage"
      className="relative group-data-[collapsible=icon]:hidden"
    >
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Not now"
        className="absolute top-2 right-2"
        onClick={dismissInstallCard}
      >
        <CloseIcon />
      </Button>
      <CardContent className="space-y-2">
        <p className="pr-6 text-title-small">Install MileWage</p>
        <p className="text-body-small text-muted-foreground">
          Open it from your dock or home screen, in its own window.
        </p>
        {state === 'prompt' ? (
          <InstallButton size="sm" />
        ) : (
          <p className="text-body-small">{STEPS[state]}</p>
        )}
      </CardContent>
    </Card>
  );
}

const TEXT: Record<InstallState, string> = {
  installed:
    'MileWage is installed on this device. It opens in its own window from your dock, Start menu or home screen.',
  prompt:
    'Install MileWage to open it from your dock, Start menu or home screen, in its own window.',
  ios: 'Add MileWage to your Home Screen to open it like an app.',
  'safari-mac': 'Add MileWage to your Dock to open it in its own window.',
  'firefox-android': 'Add MileWage to your Home screen to open it like an app.',
  insecure:
    'Browsers install apps only from a secure address, and this page was opened at an http:// address. Open MileWage at its https:// address (for example through Tailscale) to install it.',
  unsupported:
    'This browser has not offered to install MileWage here. In Chrome or Edge, use the install icon in the address bar or Install in the browser menu; on an iPhone or iPad, Share, then Add to Home Screen; in Safari on a Mac, File, then Add to Dock.',
};

/** Settings › App on this device: always there, whatever the sidebar card did. */
export function InstallSection() {
  const { state } = useInstall();
  return (
    <section aria-label="Install" className="space-y-3">
      <p className="text-body-medium text-muted-foreground">{TEXT[state]}</p>
      {state === 'prompt' ? <InstallButton /> : null}
      {STEPS[state] ? <p className="text-title-small">{STEPS[state]}</p> : null}
    </section>
  );
}
