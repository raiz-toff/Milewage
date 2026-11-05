import type { ReactNode } from 'react';
import type { Modules } from './api/client';
import { Backups } from './pages/Backups';
import { Dashboard } from './pages/Dashboard';
import { ExpensesPage } from './pages/Expenses';
import { ExportsPage } from './pages/Exports';
import { Devices } from './pages/Devices';
import { SettingsPage } from './pages/SettingsPage';
import { LivePage } from './pages/Live';
import { OdometerPage } from './pages/Odometer';
import { ShiftsRoutes } from './pages/Shifts';
import { TaxPage } from './pages/Tax';
import { VehiclesPage } from './pages/Vehicles';

/**
 * Every signed-in screen, in navigation order. `visible` is the module-flag rule of 05 section
 * 5: a screen whose module is off is neither in the navigation nor reachable by URL.
 * Core screens have no rule and are always present.
 */
export interface Screen {
  /** Route pattern; a trailing /* lets the screen own sub-routes. */
  path: string;
  label: string;
  visible?: (modules: Modules) => boolean;
  element: ReactNode;
}

export const screens: Screen[] = [
  { path: '/dashboard', label: 'Dashboard', element: <Dashboard /> },
  { path: '/live', label: 'Live map', visible: (m) => m.live, element: <LivePage /> },
  { path: '/shifts/*', label: 'Shifts', element: <ShiftsRoutes /> },
  {
    path: '/expenses',
    label: 'Expenses',
    visible: (m) => m.expenses,
    element: <ExpensesPage />,
  },
  { path: '/tax', label: 'Tax', visible: (m) => m.tax, element: <TaxPage /> },
  { path: '/vehicles', label: 'Vehicles', element: <VehiclesPage /> },
  { path: '/odometer', label: 'Odometer', element: <OdometerPage /> },
  {
    path: '/exports',
    label: 'Exports',
    visible: (m) => m.exporters.length > 0,
    element: <ExportsPage />,
  },
  { path: '/devices', label: 'Devices', visible: (m) => m.devices, element: <Devices /> },
  { path: '/backups', label: 'Backups', element: <Backups /> },
  { path: '/settings', label: 'Settings', element: <SettingsPage /> },
];

/**
 * URL paths that the static host must answer with index.html: "/" plus each screen, and for a
 * pattern ending in /* the bare path too. infra/docker/Caddyfile lists them; a test keeps the
 * two in step.
 */
export const spaPaths = (list: Screen[] = screens): string[] => [
  '/',
  ...list.flatMap((s) => (s.path.endsWith('/*') ? [s.path.slice(0, -2), s.path] : [s.path])),
];

export const visibleScreens = (modules: Modules): Screen[] =>
  screens.filter((s) => !s.visible || s.visible(modules));
