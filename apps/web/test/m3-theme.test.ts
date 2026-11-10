import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OUT, OVERRIDES, SEED, buildFiles, buildScheme } from '../scripts/m3-theme.mjs';

/** OKLCH lightness and chroma of a `#rrggbb` colour (Björn Ottosson's OKLab). */
function oklch(hex: string | undefined): { l: number; c: number } {
  if (!hex) throw new Error('missing colour');
  const lin = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = lin as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B) };
}

// The Material 3 scheme is generated (scripts/m3-theme.mjs) and committed.
describe('generated Material 3 scheme', () => {
  const scheme = buildScheme();

  it('the committed CSS and JSON are what the script writes (run `npm run theme -w apps/web`)', () => {
    const files = buildFiles();
    expect(readFileSync(OUT.css, 'utf8')).toBe(files.css);
    expect(readFileSync(OUT.json, 'utf8')).toBe(files.json);
  });

  it('keeps Lane yellow itself as the primary container, in light and in dark', () => {
    expect(scheme.light.primaryContainer).toBe(SEED.toLowerCase());
    expect(scheme.dark.primaryContainer).toBe(SEED.toLowerCase());
  });

  it('has every role index.css reads, in both themes', () => {
    const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
    const generated = readFileSync(OUT.css, 'utf8');
    const used = new Set(
      [...css.matchAll(/var\((--md-(?:sys|extended)-color-[a-z0-9-]+)\)/g)].map((m) => m[1]!),
    );
    expect(used.size).toBeGreaterThan(30);
    for (const block of generated.split(/\n\n/)) {
      for (const name of used) expect(block, name).toContain(`${name}:`);
    }
  });

  it('writes every override it documents, with a reason', () => {
    for (const [role, o] of Object.entries(OVERRIDES)) {
      expect(o.why.length, role).toBeGreaterThan(20);
      expect(scheme.overrides[role], role).toBeDefined();
    }
  });

  describe.each(['light', 'dark'] as const)('the %s theme', (theme) => {
    const roles = scheme[theme];

    // The yellow is the brand's mark, not the atmosphere: no neutral role leans towards it.
    it('carries no yellow in the neutral roles (OKLCH chroma under 0.02)', () => {
      const neutral = [
        'background',
        'surface',
        'surfaceDim',
        'surfaceBright',
        'surfaceContainerLowest',
        'surfaceContainerLow',
        'surfaceContainer',
        'surfaceContainerHigh',
        'surfaceContainerHighest',
        'surfaceVariant',
        'onSurface',
        'onSurfaceVariant',
        'outline',
        'outlineVariant',
        'inverseSurface',
        'inverseOnSurface',
        'secondaryContainer',
        'onSecondaryContainer',
        'secondary',
      ] as const;
      for (const role of neutral) expect(oklch(roles[role]).c, role).toBeLessThan(0.02);
    });

    it('draws primary in ink, not gold: dark in light, near-white in dark, and neutral', () => {
      const { l, c } = oklch(roles.primary);
      expect(c).toBeLessThan(0.02);
      if (theme === 'light') expect(l).toBeLessThan(0.35);
      else expect(l).toBeGreaterThan(0.85);
      expect(roles.surfaceTint).toBe(roles.primary);
    });

    it('labels the yellow in Asphalt', () => {
      expect(oklch(roles.onPrimaryContainer).l).toBeLessThan(0.25);
      expect(oklch(roles.onPrimaryContainer).c).toBeLessThan(0.02);
    });

    it('has eight chart series and the semantic chart colours', () => {
      const chart = scheme.chart[theme];
      for (let i = 1; i <= 8; i++) expect(chart[`series${i}` as keyof typeof chart]).toMatch(/^#/);
      expect(chart.earned).toBe(roles.earned);
      expect(chart.spent).toBe(roles.spent);
      expect(chart.grid).toBe(roles.outlineVariant);
      expect(chart.axis).toBe(roles.outline);
      expect(oklch(chart.measure).c).toBeLessThan(0.05);
    });
  });
});
