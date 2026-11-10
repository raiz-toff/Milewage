import { useState } from 'react';
import { RefreshIcon } from '@/ui/icons';
import { Button } from '@/components/ui/button';
import { useUpdate } from './update';

/**
 * "A new version of MileWage is ready", bottom right, over every screen (plan 27 section 4.3).
 * The live region is always there, so screen readers announce the message when it appears.
 */
export function UpdatePrompt() {
  const { ready, reload, later } = useUpdate();
  const [busy, setBusy] = useState(false);
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 flex justify-end"
    >
      {ready ? (
        <div className="pointer-events-auto flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-extra-small bg-inverse-surface py-1.5 pr-2 pl-4 text-inverse-on-surface shadow-elevation-3 sm:w-auto sm:max-w-xl">
          <RefreshIcon className="size-5 shrink-0" />
          <p className="min-w-0 flex-1 py-1.5 text-body-medium">
            A new version of MileWage is ready.
          </p>
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" className="text-inverse-primary" onClick={later}>
              Later
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-inverse-primary disabled:text-inverse-on-surface/60"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                reload();
              }}
            >
              {busy ? 'Reloading' : 'Reload'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
