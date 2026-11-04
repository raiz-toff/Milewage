import type { ReactNode } from 'react';
import type { Modules } from './api/client';
import { Devices } from './pages/Devices';
import { SettingsPage } from './pages/SettingsPage';

/**
 * Every signed-in screen, in navigation order. `visible` is the module-flag rule of 05 section
 * 5: a screen whose module is off is neither in the navigation nor reachable by URL.
 * Core screens have no rule and are always present.
 */
export interface Screen {
  path: string;
  label: string;
  visible?: (modules: Modules) => boolean;
  element: ReactNode;
}

export const screens: Screen[] = [
  {
    path: '/',
    label: 'Home',
    element: <p className="text-muted">Signed in. Screens arrive in the next changes.</p>,
  },
  { path: '/devices', label: 'Devices', visible: (m) => m.devices, element: <Devices /> },
  { path: '/settings', label: 'Settings', element: <SettingsPage /> },
];

export const visibleScreens = (modules: Modules): Screen[] =>
  screens.filter((s) => !s.visible || s.visible(modules));
