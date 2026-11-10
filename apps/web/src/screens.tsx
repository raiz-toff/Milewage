import type { ReactNode } from 'react';
import {
  AnalyticsIcon,
  BackupsIcon,
  DashboardIcon,
  DevicesIcon,
  ExpensesIcon,
  ExportsIcon,
  GoalsIcon,
  OdometerIcon,
  ProgressIcon,
  ScheduleIcon,
  SettingsIcon,
  ShiftsIcon,
  TaxIcon,
  VehiclesIcon,
} from '@/ui/icons';
import type { IconComponent } from '@/ui/icons';
import type { Modules, Settings as SettingsRecord } from './api/client';
import { helpScreen } from './help';
import { AnalyticsPage } from './pages/Analytics';
import { ConnectAssistant } from './pages/ConnectAssistant';
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
import { publicPages } from './publicPages';

/**
 * What decides whether a screen is there: the server's module flags, plus the owner's switches
 * that are preferences rather than modules (`help`, from `settings.help_enabled`; ADR 0002).
 */
export type ScreenFlags = Modules & { help: boolean };

export const screenFlags = (s: SettingsRecord): ScreenFlags => ({
  ...s.modules,
  help: s.help_enabled,
});

/**
 * Every signed-in screen, in navigation order. `visible` is the module-flag rule of 05 section
 * 5: a screen whose module is off is neither in the navigation nor reachable by URL.
 * Core screens have no rule and are always present.
 */
export interface Screen {
  /** Route pattern; a trailing /* lets the screen own sub-routes. */
  path: string;
  label: string;
  visible?: (flags: ScreenFlags) => boolean;
  element: ReactNode;
  /** Sidebar entry. Absent means not in the sidebar (the header bell opens Notifications). */
  nav?: { icon: IconComponent; group: NavGroup };
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
    nav: { icon: DashboardIcon, group: 'overview' },
  },
  {
    path: '/shifts/*',
    label: 'Shifts',
    element: <ShiftsRoutes />,
    nav: { icon: ShiftsIcon, group: 'overview' },
  },
  {
    path: '/schedule',
    label: 'Schedule',
    visible: (m) => m.schedule,
    element: <SchedulePage />,
    nav: { icon: ScheduleIcon, group: 'overview' },
  },
  {
    path: '/analytics',
    label: 'Analytics',
    visible: (m) => m.analytics,
    element: <AnalyticsPage />,
    nav: { icon: AnalyticsIcon, group: 'money' },
  },
  {
    path: '/expenses',
    label: 'Expenses',
    visible: (m) => m.expenses,
    element: <ExpensesPage />,
    nav: { icon: ExpensesIcon, group: 'money' },
  },
  {
    path: '/goals',
    label: 'Goals',
    visible: (m) => m.goals,
    element: <GoalsPage />,
    nav: { icon: GoalsIcon, group: 'money' },
  },
  {
    path: '/progress',
    label: 'Progress',
    visible: (m) => m.progress,
    element: <ProgressPage />,
    nav: { icon: ProgressIcon, group: 'money' },
  },
  {
    path: '/tax',
    label: 'Tax',
    visible: (m) => m.tax,
    element: <TaxPage />,
    nav: { icon: TaxIcon, group: 'money' },
  },
  {
    path: '/exports',
    label: 'Exports',
    visible: (m) => m.exporters.length > 0,
    element: <ExportsPage />,
    nav: { icon: ExportsIcon, group: 'money' },
  },
  {
    path: '/vehicles',
    label: 'Vehicles',
    element: <VehiclesPage />,
    nav: { icon: VehiclesIcon, group: 'vehicle' },
  },
  {
    path: '/odometer',
    label: 'Odometer',
    element: <OdometerPage />,
    nav: { icon: OdometerIcon, group: 'vehicle' },
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
    nav: { icon: DevicesIcon, group: 'system' },
  },
  {
    path: '/backups',
    label: 'Backups',
    element: <Backups />,
    nav: { icon: BackupsIcon, group: 'system' },
  },
  {
    path: '/settings/*',
    label: 'Settings',
    element: <SettingsPage />,
    nav: { icon: SettingsIcon, group: 'system' },
  },
  helpScreen,
  {
    // An assistant's sign-in request lands here (OAuth `authorization_endpoint`); not in the sidebar.
    path: '/oauth/authorize',
    label: 'Connect an assistant',
    visible: (m) => m.mcp,
    element: <ConnectAssistant />,
  },
];

/**
 * URL paths that the static host must answer with index.html: "/" plus each screen, and for a
 * pattern ending in /* the bare path too. infra/docker/Caddyfile lists them; a test keeps the
 * two in step.
 */
export const spaPaths = (list: Screen[] = screens): string[] => [
  '/',
  ...Object.keys(publicPages), // public: no sign-in (publicPages.tsx)
  '/onboarding', // the setup wizard (App.tsx), so a reload on a step works
  '/onboarding/*',
  ...list.flatMap((s) => (s.path.endsWith('/*') ? [s.path.slice(0, -2), s.path] : [s.path])),
];

export const visibleScreens = (flags: ScreenFlags): Screen[] =>
  screens.filter((s) => !s.visible || s.visible(flags));
