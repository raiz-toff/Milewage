import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
        <Card size="sm" className="pointer-events-auto w-full shadow-lg sm:w-auto">
          <CardContent className="flex flex-wrap items-center gap-3">
            <RefreshCw aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <p className="min-w-0 flex-1 text-sm">A new version of MileWage is ready.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={later}>
                Later
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  reload();
                }}
              >
                {busy ? 'Reloading' : 'Reload'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
