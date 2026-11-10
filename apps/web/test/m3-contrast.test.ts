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

/** Distance in OKLab, ×100 (the data-viz skill's ΔE): how different two colours look. */
function deltaE(a: string, b: string): number {
  const lab = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  };
  const [x, y] = [lab(a), lab(b)];
  return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!) * 100;
}

type Role = keyof typeof scheme.light;

/** Every surface a page, card, menu, dialog or field can put text or a mark on. */
const SURFACES: Role[] = [
  'background',
  'surface',
  'surfaceContainerLowest',
  'surfaceContainerLow',
  'surfaceContainer',
  'surfaceContainerHigh',
  'surfaceContainerHighest',
];

/** The card of each theme (index.css `--card`): white in light, surface-container in dark. */
const CARD = { light: 'surfaceContainerLowest', dark: 'surfaceContainer' } as const;

/** Text on its own container: 4.5:1 (WCAG 1.4.3). */
const TEXT_ON_CONTAINER: [Role, Role][] = [
  ['onPrimary', 'primary'],
  // The brand button's label: Asphalt on Lane yellow.
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

/** Roles drawn as text straight on any surface (body, secondary text, text buttons, errors). */
const TEXT_ON_SURFACE: Role[] = ['onSurface', 'onSurfaceVariant', 'primary', 'error'];

/**
 * Money figures sit on the page, a card or a field on a card, never on the muted fills
 * (surface-container-highest): earned and spent as text reach 4.5:1 there.
 */
const MONEY_SURFACES: Role[] = [
  'background',
  'surface',
  'surfaceContainerLowest',
  'surfaceContainerLow',
  'surfaceContainer',
  'surfaceContainerHigh',
];

/**
 * Roles that carry meaning as marks (field outlines, checked controls, progress, money bars, and
 * the focus ring, which is `primary` drawn 2 px off the control, so on the surface): 3:1
 * (WCAG 1.4.11).
 */
const MARKS: Role[] = ['outline', 'primary', 'earned', 'spent'];

describe.each(['light', 'dark'] as const)('the %s scheme', (theme) => {
  const roles = scheme[theme];
  const chart = scheme.chart[theme];
  const card = roles[CARD[theme]];

  it.each(TEXT_ON_CONTAINER)('%s on %s reaches 4.5:1', (fg, bg) => {
    expect(ratio(roles[fg], roles[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(TEXT_ON_SURFACE)('%s text reaches 4.5:1 on every surface', (fg) => {
    for (const bg of SURFACES) expect(ratio(roles[fg], roles[bg]), bg).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['earned', 'spent'] as const)('%s as text reaches 4.5:1 where money is shown', (fg) => {
    for (const bg of MONEY_SURFACES)
      expect(ratio(roles[fg], roles[bg]), bg).toBeGreaterThanOrEqual(4.5);
  });

  it.each(MARKS)('%s as a mark reaches 3:1 on every surface', (fg) => {
    for (const bg of SURFACES) expect(ratio(roles[fg], roles[bg]), bg).toBeGreaterThanOrEqual(3);
  });

  it('a selected pill or chip is told from the card and the page by more than its colour', () => {
    // The pill carries a check or a filled icon too; its fill only has to be visible.
    expect(ratio(roles.secondaryContainer, card)).toBeGreaterThan(1.15);
    expect(ratio(roles.secondaryContainer, roles.background)).toBeGreaterThan(1.1);
  });

  it('spent is visibly not error (destructive), and earned is not spent', () => {
    expect(deltaE(roles.spent, roles.error)).toBeGreaterThanOrEqual(7);
    expect(deltaE(roles.earned, roles.spent)).toBeGreaterThanOrEqual(20);
  });

  it('every chart colour reaches 3:1 on a card', () => {
    const marks = [
      ...Array.from({ length: 8 }, (_, i) => chart[`series${i + 1}` as keyof typeof chart]),
      chart.earned,
      chart.spent,
      chart.measure,
      chart.other,
      chart.axis,
    ];
    for (const c of marks) expect(ratio(c, card), c).toBeGreaterThanOrEqual(3);
  });

  it('neighbouring chart series stay apart for full colour vision (OKLab ΔE ≥ 15)', () => {
    for (let i = 1; i < 8; i++) {
      const [a, b] = [`series${i}`, `series${i + 1}`] as (keyof typeof chart)[];
      expect(deltaE(chart[a!], chart[b!]), `${a} ${b}`).toBeGreaterThanOrEqual(15);
    }
  });
});
