import { useEffect, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';

const KEY = 'mw-theme';
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

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
