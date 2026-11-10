#!/usr/bin/env node
/* global process, console, URL */
/**
 * Writes the Material 3 colour scheme of the web app from the brand seed, with Google's
 * material-color-utilities (the algorithm Android's dynamic colour uses, so the phone and the web
 * get the same roles from the same seed):
 *
 *   src/theme/m3-scheme.css   the roles as `--md-sys-color-*` (light on :root, dark on .dark), and
 *                             the money roles as `--md-extended-color-*`; index.css imports it
 *   src/theme/m3-scheme.json  the same values, for checking the Android app against
 *
 * Run `npm run theme -w apps/web` after changing the seed or the variant, and commit both files.
 * `node scripts/m3-theme.mjs --check` (and test/m3-theme.test.ts) fails when they are stale.
 *
 * The variant: Fidelity (SchemeFidelity, 2021 spec = the Material 3 baseline, standard contrast).
 * Compared from the seed #FFC21F (HCT hue 86, chroma 58, tone 82):
 *   - Tonal spot (the default) caps the primary palette at chroma 36: primary #785a0b and primary
 *     container #ffdf9e in light, #e9c16c in dark. A muted olive gold; the yellow is gone.
 *   - Vibrant (2021) keeps more chroma but its primary container is the pale #ffdf9e in light and
 *     the brown #5b4300 in dark, so the brand never appears as a filled area.
 *   - Content and Fidelity both keep the seed's own chroma, and set primary container to the seed
 *     itself: exactly #FFC21F in light and in dark, with on-primary-container #6e5100 (4.57:1)
 *     and primary #795900 in light (6.2:1 on surface). They differ only in tertiary: Content's is
 *     an analogous lime (#556500), which would read as green, and green means money in only;
 *     Fidelity's is the complementary teal (#006877). Fidelity therefore.
 * Every text and background pair of the scheme reaches 4.5:1 and every mark 3:1 in both themes;
 * test/m3-contrast.test.ts holds that.
 *
 * Money colours are custom roles outside the scheme (Material's "custom colors"): Earned and Spent,
 * each a colour, an on-colour, a container and an on-container, harmonised towards the seed
 * (Blend.harmonize, a hue shift of at most 15 degrees) so they sit with the yellow. Signal blue
 * gets the same four roles but is not harmonised: from a yellow seed the shift would turn it
 * indigo, and it must read as the blue of the live position marker. It stays reserved; nothing
 * uses it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

// material-color-utilities 0.4.0 is published as ESM with extension-less relative imports (it is
// written for bundlers). Node's loader needs the `.js`; this adds it for that package only.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      const fromMcu = context.parentURL?.includes('/@material/material-color-utilities/');
      if (fromMcu && specifier.startsWith('.') && !specifier.endsWith('.js'))
        return next(`${specifier}.js`, context);
      throw error;
    }
  },
});
const { Hct, SchemeFidelity, argbFromHex, customColor, hexFromArgb } =
  await import('@material/material-color-utilities');

/** Lane yellow, the brand (branding/README). */
export const SEED = '#FFC21F';
export const VARIANT = 'fidelity';
export const SPEC_VERSION = '2021';
export const CONTRAST_LEVEL = 0;

/** The brand's money and signal hues, harmonised into the scheme as custom colours. */
export const CUSTOM = [
  { name: 'earned', value: '#34D399', blend: true },
  { name: 'spent', value: '#FF6B5E', blend: true },
  { name: 'signal', value: '#4C8DFF', blend: false },
];

/** The roles written out, in the order of the Material 3 colour roles reference. */
export const ROLES = [
  'primary',
  'onPrimary',
  'primaryContainer',
  'onPrimaryContainer',
  'inversePrimary',
  'primaryFixed',
  'primaryFixedDim',
  'onPrimaryFixed',
  'onPrimaryFixedVariant',
  'secondary',
  'onSecondary',
  'secondaryContainer',
  'onSecondaryContainer',
  'secondaryFixed',
  'secondaryFixedDim',
  'onSecondaryFixed',
  'onSecondaryFixedVariant',
  'tertiary',
  'onTertiary',
  'tertiaryContainer',
  'onTertiaryContainer',
  'tertiaryFixed',
  'tertiaryFixedDim',
  'onTertiaryFixed',
  'onTertiaryFixedVariant',
  'error',
  'onError',
  'errorContainer',
  'onErrorContainer',
  'background',
  'onBackground',
  'surface',
  'onSurface',
  'surfaceVariant',
  'onSurfaceVariant',
  'surfaceDim',
  'surfaceBright',
  'surfaceContainerLowest',
  'surfaceContainerLow',
  'surfaceContainer',
  'surfaceContainerHigh',
  'surfaceContainerHighest',
  'surfaceTint',
  'outline',
  'outlineVariant',
  'inverseSurface',
  'inverseOnSurface',
  'scrim',
  'shadow',
];

const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const cap = (name) => name[0].toUpperCase() + name.slice(1);

/** One theme's roles as `{ primary: '#795900', ... }`, the custom colours included. */
function theme(dark) {
  const source = argbFromHex(SEED);
  const scheme = new SchemeFidelity(Hct.fromInt(source), dark, CONTRAST_LEVEL, SPEC_VERSION);
  const roles = Object.fromEntries(ROLES.map((r) => [r, hexFromArgb(scheme[r])]));
  for (const c of CUSTOM) {
    const group = customColor(source, {
      name: c.name,
      value: argbFromHex(c.value),
      blend: c.blend,
    });
    const g = dark ? group.dark : group.light;
    roles[c.name] = hexFromArgb(g.color);
    roles[`on${cap(c.name)}`] = hexFromArgb(g.onColor);
    roles[`${c.name}Container`] = hexFromArgb(g.colorContainer);
    roles[`on${cap(c.name)}Container`] = hexFromArgb(g.onColorContainer);
  }
  return roles;
}

const customKeys = new Set(
  CUSTOM.flatMap((c) => [
    c.name,
    `on${cap(c.name)}`,
    `${c.name}Container`,
    `on${cap(c.name)}Container`,
  ]),
);

/** The scheme as data: what the JSON file holds. */
export function buildScheme() {
  return {
    seed: SEED,
    variant: VARIANT,
    specVersion: SPEC_VERSION,
    contrastLevel: CONTRAST_LEVEL,
    customColors: Object.fromEntries(
      CUSTOM.map((c) => [c.name, { value: c.value, harmonized: c.blend }]),
    ),
    light: theme(false),
    dark: theme(true),
  };
}

function block(selector, roles) {
  const lines = Object.entries(roles).map(([role, hex]) => {
    const prefix = customKeys.has(role) ? '--md-extended-color' : '--md-sys-color';
    return `  ${prefix}-${kebab(role)}: ${hex};`;
  });
  return `${selector} {\n${lines.join('\n')}\n}\n`;
}

/** The two files, as their text. */
export function buildFiles() {
  const scheme = buildScheme();
  const head =
    `/* Generated by apps/web/scripts/m3-theme.mjs from the seed ${SEED} ` +
    `(${VARIANT}, spec ${SPEC_VERSION}). Do not edit; run \`npm run theme -w apps/web\`. */\n`;
  return {
    css: `${head}${block(':root', scheme.light)}\n${block('.dark', scheme.dark)}`,
    json: `${JSON.stringify(scheme, null, 2)}\n`,
  };
}

export const OUT = {
  css: fileURLToPath(new URL('../src/theme/m3-scheme.css', import.meta.url)),
  json: fileURLToPath(new URL('../src/theme/m3-scheme.json', import.meta.url)),
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = buildFiles();
  if (process.argv.includes('--check')) {
    const stale = Object.entries(OUT).filter(([k, path]) => {
      try {
        return readFileSync(path, 'utf8') !== files[k];
      } catch {
        return true;
      }
    });
    for (const [, path] of stale)
      console.error(`${path} is out of date; run npm run theme -w apps/web`);
    process.exit(stale.length ? 1 : 0);
  }
  for (const [k, path] of Object.entries(OUT)) writeFileSync(path, files[k]);
  console.log(`Wrote ${OUT.css} and ${OUT.json}`);
}
