import { describe, expect, it } from 'vitest';
import scheme from '../src/theme/m3-scheme.json';

/** WCAG 2 relative luminance and contrast ratio of two `#rrggbb` colours. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

type Role = keyof typeof scheme.light;

/** Every surface a page, card, menu, dialog or field can put text or a mark on. */
const SURFACES: Role[] = [
  'surface',
  'surfaceContainerLowest',
  'surfaceContainerLow',
  'surfaceContainer',
  'surfaceContainerHigh',
  'surfaceContainerHighest',
];

/** Text on its own container: 4.5:1 (WCAG 1.4.3). */
const TEXT_ON_CONTAINER: [Role, Role][] = [
  ['onPrimary', 'primary'],
  ['onPrimaryContainer', 'primaryContainer'],
  ['onSecondaryContainer', 'secondaryContainer'],
  ['onTertiary', 'tertiary'],
  ['onTertiaryContainer', 'tertiaryContainer'],
  ['onError', 'error'],
  ['onErrorContainer', 'errorContainer'],
  ['inverseOnSurface', 'inverseSurface'],
  ['onEarned', 'earned'],
  ['onEarnedContainer', 'earnedContainer'],
  ['onSpent', 'spent'],
  ['onSpentContainer', 'spentContainer'],
];

/** Roles drawn as text straight on a surface (body, secondary text, text buttons, money, errors). */
const TEXT_ON_SURFACE: Role[] = [
  'onSurface',
  'onSurfaceVariant',
  'primary',
  'error',
  'earned',
  'spent',
];

/** Roles that carry meaning as marks (field outlines, controls, chart bars): 3:1 (WCAG 1.4.11). */
const MARKS: Role[] = ['outline', 'primary', 'earned', 'spent'];

describe.each(['light', 'dark'] as const)('the %s scheme', (theme) => {
  const roles = scheme[theme];

  it.each(TEXT_ON_CONTAINER)('%s on %s reaches 4.5:1', (fg, bg) => {
    expect(ratio(roles[fg], roles[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(TEXT_ON_SURFACE)('%s text reaches 4.5:1 on every surface', (fg) => {
    for (const bg of SURFACES) expect(ratio(roles[fg], roles[bg]), bg).toBeGreaterThanOrEqual(4.5);
  });

  it.each(MARKS)('%s as a mark reaches 3:1 on every surface', (fg) => {
    for (const bg of SURFACES) expect(ratio(roles[fg], roles[bg]), bg).toBeGreaterThanOrEqual(3);
  });

  it('the first chart colour reaches 3:1 on cards (primary in light, Lane yellow in dark)', () => {
    const chart1 = theme === 'light' ? roles.primary : roles.primaryContainer;
    expect(ratio(chart1, roles.surfaceContainerLow)).toBeGreaterThanOrEqual(3);
  });
});
