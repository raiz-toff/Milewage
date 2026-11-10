// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { FAVICONS, THEME_COLORS, applyTheme } from '../src/theme';

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
    // The page background is Material's surface role, whose values the generated scheme holds.
    const css = readFileSync(join(import.meta.dirname, '../src/index.css'), 'utf8');
    expect(css).toMatch(/:root \{[^}]*?--background: var\(--md-sys-color-surface\);/);
    expect(css).not.toMatch(/\.dark \{[^}]*?--background:/);
    const scheme = readFileSync(join(import.meta.dirname, '../src/theme/m3-scheme.css'), 'utf8');
    const surface = (block: string) =>
      new RegExp(`${block} \\{[^}]*?--md-sys-color-surface: (#\\w+);`).exec(scheme)?.[1];
    expect(surface(':root')).toBe(THEME_COLORS.light);
    expect(surface('\\.dark')).toBe(THEME_COLORS.dark);
  });
});

describe('the tab icon follows the theme too (B2)', () => {
  const icon = () =>
    document
      .querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]')
      ?.getAttribute('href');

  it('a picked theme gets its own icon; "system" keeps the one that follows the OS', () => {
    load(true);
    applyTheme('light');
    expect(icon()).toBe(FAVICONS.light);
    applyTheme('dark');
    expect(icon()).toBe(FAVICONS.dark);
    applyTheme('system');
    expect(icon()).toBe('/favicon.svg');
  });

  it('light pages get the Asphalt coin, dark pages the yellow coin; the OS icon switches itself', () => {
    const pub = join(import.meta.dirname, '../public');
    const svg = (name: string) => readFileSync(join(pub, name), 'utf8');
    const coin = (text: string) => /class="coin"[^>]*fill="(#\w+)"/.exec(text)?.[1];
    expect(coin(svg('favicon-light.svg'))).toBe('#101214');
    expect(coin(svg('favicon-dark.svg'))).toBe('#FFC21F');
    expect(coin(svg('favicon.svg'))).toBe('#101214');
    expect(svg('favicon.svg')).toMatch(
      /@media \(prefers-color-scheme: dark\)\{\.coin\{fill:#FFC21F\}/,
    );
  });
});
