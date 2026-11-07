import type { ReactNode } from 'react';
import {
  CalendarClock,
  CalendarDays,
  Car,
  ChartLine,
  DatabaseBackup,
  FileDown,
  Gauge,
  Landmark,
  LayoutDashboard,
  Receipt,
  Settings,
  Smartphone,
  Target,
  Trophy,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Modules } from './api/client';
import { AnalyticsPage } from './pages/Analytics';
import { Backups } from './pages/Backups';
import { Dashboard } from './pages/Dashboard';
import { ExpensesPage } from './pages/Expenses';
import { ExportsPage } from './pages/Exports';
import { Devices } from './pages/Devices';
import { ProgressPage } from './pages/Progress';
import { SchedulePage } from './pages/Schedule';
import { SettingsPage } from './pages/SettingsPage';
import { NotificationsPage } from './pages/Notifications';
import { OdometerPage } from './pages/Odometer';
import { ShiftsRoutes } from './pages/Shifts';
import { GoalsPage } from './pages/Goals';
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
  /** Sidebar entry. Absent means not in the sidebar (the header bell opens Notifications). */
  nav?: { icon: LucideIcon; group: NavGroup };
}

export type NavGroup = 'overview' | 'money' | 'vehicle' | 'system';

/** Sidebar groups in order, with their headings. */
export const navGroups: { id: NavGroup; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'money', label: 'Money' },
  { id: 'vehicle', label: 'Vehicle' },
  { id: 'system', label: 'System' },
];

export const screens: Screen[] = [
  {
    path: '/dashboard',
    label: 'Dashboard',
    element: <Dashboard />,
    nav: { icon: LayoutDashboard, group: 'overview' },
  },
  {
    path: '/shifts/*',
    label: 'Shifts',
    element: <ShiftsRoutes />,
    nav: { icon: CalendarDays, group: 'overview' },
  },
  {
    path: '/schedule',
    label: 'Schedule',
    visible: (m) => m.schedule,
    element: <SchedulePage />,
    nav: { icon: CalendarClock, group: 'overview' },
  },
  {
    path: '/analytics',
    label: 'Analytics',
    visible: (m) => m.analytics,
    element: <AnalyticsPage />,
    nav: { icon: ChartLine, group: 'money' },
  },
  {
    path: '/expenses',
    label: 'Expenses',
    visible: (m) => m.expenses,
    element: <ExpensesPage />,
    nav: { icon: Receipt, group: 'money' },
  },
  {
    path: '/goals',
    label: 'Goals',
    visible: (m) => m.goals,
    element: <GoalsPage />,
    nav: { icon: Target, group: 'money' },
  },
  {
    path: '/progress',
    label: 'Progress',
    visible: (m) => m.progress,
    element: <ProgressPage />,
    nav: { icon: Trophy, group: 'money' },
  },
  {
    path: '/tax',
    label: 'Tax',
    visible: (m) => m.tax,
    element: <TaxPage />,
    nav: { icon: Landmark, group: 'money' },
  },
  {
    path: '/exports',
    label: 'Exports',
    visible: (m) => m.exporters.length > 0,
    element: <ExportsPage />,
    nav: { icon: FileDown, group: 'money' },
  },
  {
    path: '/vehicles',
    label: 'Vehicles',
    element: <VehiclesPage />,
    nav: { icon: Car, group: 'vehicle' },
  },
  {
    path: '/odometer',
    label: 'Odometer',
    element: <OdometerPage />,
    nav: { icon: Gauge, group: 'vehicle' },
  },
  {
    path: '/notifications',
    label: 'Notifications',
    visible: (m) => m.notifications,
    element: <NotificationsPage />,
  },
  {
    path: '/devices',
    label: 'Devices',
    visible: (m) => m.devices,
    element: <Devices />,
    nav: { icon: Smartphone, group: 'system' },
  },
  {
    path: '/backups',
    label: 'Backups',
    element: <Backups />,
    nav: { icon: DatabaseBackup, group: 'system' },
  },
  {
    path: '/settings/*',
    label: 'Settings',
    element: <SettingsPage />,
    nav: { icon: Settings, group: 'system' },
  },
];

/**
 * URL paths that the static host must answer with index.html: "/" plus each screen, and for a
 * pattern ending in /* the bare path too. infra/docker/Caddyfile lists them; a test keeps the
 * two in step.
 */
export const spaPaths = (list: Screen[] = screens): string[] => [
  '/',
  '/pair', // public: the pairing QR's page (main.tsx)
  ...list.flatMap((s) => (s.path.endsWith('/*') ? [s.path.slice(0, -2), s.path] : [s.path])),
];

export const visibleScreens = (modules: Modules): Screen[] =>
  screens.filter((s) => !s.visible || s.visible(modules));
