import { lazy, Suspense } from 'react';
import { CircleHelp } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { Screen } from '../screens';

// The pages and the Markdown renderer load only when Help opens; the service worker precaches
// the chunk, so it opens offline once the app is up.
const HelpRoutes = lazy(() => import('./HelpRoutes'));

function Loading() {
  return (
    <div className="max-w-3xl space-y-4" aria-busy="true">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

/** The Help screen (ADR 0001): `/help`, `/help/<slug>` and `/help/whats-new`. */
export const helpScreen: Screen = {
  path: '/help/*',
  label: 'Help',
  visible: (f) => f.help,
  element: (
    <Suspense fallback={<Loading />}>
      <HelpRoutes />
    </Suspense>
  ),
  nav: { icon: CircleHelp, group: 'system' },
};
