// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { THEME_COLORS, applyTheme } from '../src/theme';

const html = readFileSync(join(import.meta.dirname, '../index.html'), 'utf8');

/** The real <head> of index.html, with an OS that prefers `dark` or not. */
function load(osDark: boolean) {
  document.head.innerHTML = new DOMParser().parseFromString(html, 'text/html').head.innerHTML;
  window.matchMedia = (query: string) =>
    ({ matches: osDark && query.includes('dark'), media: query }) as MediaQueryList;
}

const colours = () =>
  [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map(
    (m) => `${m.getAttribute('media')?.includes('dark') ? 'dark' : 'light'} ${m.content}`,
  );

describe('theme-color follows the theme chosen in the app (plan 27 section 4.1)', () => {
  beforeEach(() => load(false));

  it('a chosen theme colours the window bar whatever the OS prefers', () => {
    load(true);
    applyTheme('light');
    expect(colours()).toEqual([`light ${THEME_COLORS.light}`, `dark ${THEME_COLORS.light}`]);
    applyTheme('dark');
    expect(colours()).toEqual([`light ${THEME_COLORS.dark}`, `dark ${THEME_COLORS.dark}`]);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('"system" gives each OS theme its own colour back', () => {
    applyTheme('dark');
    applyTheme('system');
    expect(colours()).toEqual([`light ${THEME_COLORS.light}`, `dark ${THEME_COLORS.dark}`]);
  });

  it('the colours are the page backgrounds of index.css', () => {
    const css = readFileSync(join(import.meta.dirname, '../src/index.css'), 'utf8');
    const bg = (block: string) =>
      new RegExp(`${block} \\{[^}]*?--background: (#\\w+);`).exec(css)?.[1];
    expect(bg(':root')).toBe(THEME_COLORS.light);
    expect(bg('\\.dark')).toBe(THEME_COLORS.dark);
  });
});
