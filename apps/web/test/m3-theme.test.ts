import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OUT, SEED, buildFiles, buildScheme } from '../scripts/m3-theme.mjs';

// The Material 3 scheme is generated from the brand seed (scripts/m3-theme.mjs) and committed.
describe('generated Material 3 scheme', () => {
  it('the committed CSS and JSON are what the script writes (run `npm run theme -w apps/web`)', () => {
    const files = buildFiles();
    expect(readFileSync(OUT.css, 'utf8')).toBe(files.css);
    expect(readFileSync(OUT.json, 'utf8')).toBe(files.json);
  });

  it('keeps Lane yellow itself as the primary container, in light and in dark', () => {
    const scheme = buildScheme();
    expect(scheme.light.primaryContainer).toBe(SEED.toLowerCase());
    expect(scheme.dark.primaryContainer).toBe(SEED.toLowerCase());
  });

  it('has every role index.css reads, in both themes', () => {
    const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
    const generated = readFileSync(OUT.css, 'utf8');
    const used = new Set(
      [...css.matchAll(/var\((--md-(?:sys|extended)-color-[a-z-]+)\)/g)].map((m) => m[1]!),
    );
    expect(used.size).toBeGreaterThan(30);
    for (const block of generated.split(/\n\n/)) {
      for (const name of used) expect(block, name).toContain(`${name}:`);
    }
  });
});
