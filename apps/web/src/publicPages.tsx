import type { ReactNode } from 'react';
import { AppPage } from './pages/AppPage';
import { PairPage } from './pages/PairPage';
import { PrivacyPage } from './pages/PrivacyPage';

/**
 * Pages anyone can open: no session, no sign-in, outside the router and the signed-in shell
 * (main.tsx). Each is also in `spaPaths`, so Caddy answers it with index.html.
 */
export const publicPages: Record<string, () => ReactNode> = {
  '/pair': () => <PairPage />, // the pairing QR's page
  '/app': () => <AppPage />, // the app download page
  '/privacy': () => <PrivacyPage />, // what MileWage records and who else sees it
};

/** The public page for a path, or null for the app itself. */
export const publicPage = (pathname: string): ReactNode =>
  Object.hasOwn(publicPages, pathname) ? publicPages[pathname]!() : null;
