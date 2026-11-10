import { useEffect, useState } from 'react';
import scheme from './theme/m3-scheme.json';

export type ThemeChoice = 'light' | 'dark' | 'system';

const KEY = 'mw-theme';
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

/**
 * Each theme's page background (index.css `--background`, Material's surface), used as the window
 * and bar colour. index.html and public/manifest.webmanifest carry the same values (a test checks).
 */
export const THEME_COLORS = { light: scheme.light.surface, dark: scheme.dark.surface } as const;

/**
 * The `theme-color` metas in index.html follow the OS (one per `prefers-color-scheme`). A theme
 * picked in the app wins over the OS, so both metas get its colour; "system" restores each one.
 */
function applyThemeColor(choice: ThemeChoice): void {
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const own = meta.getAttribute('media')?.includes('dark')
      ? THEME_COLORS.dark
      : THEME_COLORS.light;
    meta.content = choice === 'system' ? own : THEME_COLORS[choice];
  }
}

/** The tab icon for a theme: the dark coin on light pages, the yellow coin on dark ones (branding). */
export const FAVICONS = {
  system: '/favicon.svg',
  light: '/favicon-light.svg',
  dark: '/favicon-dark.svg',
} as const;

/** "system" keeps the SVG that follows the OS; a picked theme gets its own icon. */
function applyFavicon(choice: ThemeChoice): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
  if (link) link.href = FAVICONS[choice];
}

function stored(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'system' ? v : 'light';
  } catch {
    return 'light';
  }
}

/** Puts shadcn's `.dark` class on <html> for the choice; "system" follows the OS. Light is the web default. */
export function applyTheme(choice: ThemeChoice = stored()): void {
  const dark = choice === 'dark' || (choice === 'system' && darkQuery().matches);
  document.documentElement.classList.toggle('dark', dark);
  applyThemeColor(choice);
  applyFavicon(choice);
}

export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(stored);
  useEffect(() => {
    applyTheme(choice);
    if (choice !== 'system') return;
    const q = darkQuery();
    const follow = () => applyTheme('system');
    q.addEventListener('change', follow);
    return () => q.removeEventListener('change', follow);
  }, [choice]);
  const set = (next: ThemeChoice) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Storage blocked: the choice still applies for this visit.
    }
    setChoice(next);
  };
  return [choice, set];
}
