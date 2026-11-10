#!/usr/bin/env node
/* global process, console, URL */
/**
 * Writes the Material 3 colour scheme of the web app with Google's material-color-utilities (the
 * algorithm Android's dynamic colour uses):
 *
 *   src/theme/m3-scheme.css   the roles as `--md-sys-color-*` (light on :root, dark on .dark), the
 *                             money roles as `--md-extended-color-*` and the chart colours as
 *                             `--md-extended-color-chart-*`; index.css imports it
 *   src/theme/m3-scheme.json  the same values, the palettes and the override table, for the
 *                             Android app to mirror
 *
 * Run `npm run theme -w apps/web` after changing anything here, and commit both files.
 * `node scripts/m3-theme.mjs --check` (and test/m3-theme.test.ts) fails when they are stale.
 *
 * The idea ("Asphalt and lane", 2026-11-10). The brand guide names two colours: Lane yellow
 * #FFC21F and Asphalt #101214. A lane line is a thin mark on a lot of asphalt, and the interface
 * is built the same way: neutral, slightly cool surfaces at Asphalt's own hue, ink for structure,
 * and the yellow only where it means MileWage or "go" (the one main action, the map's route, the
 * logo). The previous scheme grew every role from the yellow seed, so the whole app was cream and
 * gold; this one builds Material's roles from explicit palettes instead:
 *
 *   primary palette     the seed itself, Fidelity (hue 86, chroma 58): primary-container stays
 *                       exactly #FFC21F in both themes; inverse-primary and the fixed roles
 *                       (the map's route casing reads on-primary-fixed) come from it too
 *   neutral             hue 243 chroma 4: Asphalt's own hue and chroma. Surfaces, on-surface
 *   neutral variant     hue 243 chroma 8: outlines, on-surface-variant, a touch of steel
 *   secondary           hue 243 chroma 8: selection (the active navigation pill, a chosen chip
 *                       or segment, the tonal button) is a cool grey, not a yellow tint
 *   tertiary, error     Material's own (Fidelity's teal tertiary stays unused)
 *
 * The variant stays Fidelity (SchemeFidelity's rules over these palettes, spec 2021, standard
 * contrast), so every role not in OVERRIDES is what Material computes. The overrides are the
 * places where the role model needs MileWage's answer rather than the seed's; each says why.
 *
 * Money colours are Material custom colours (a colour, an on-colour, a container and an
 * on-container from one palette) that are NOT harmonised: earned stays a clean green and spent a
 * red-orange, held apart from `error` (destructive actions) by hue. Signal blue is reserved.
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
const { DynamicScheme, Hct, TonalPalette, Variant, argbFromHex, hexFromArgb } =
  await import('@material/material-color-utilities');

/** Lane yellow, the brand (branding/README). */
export const SEED = '#FFC21F';
/** Asphalt, the brand's ink (branding/README). The neutrals are built at its hue and chroma. */
export const ASPHALT = '#101214';
export const VARIANT = 'fidelity';
export const SPEC_VERSION = '2021';
export const CONTRAST_LEVEL = 0;

/** The palettes the scheme is built from, as HCT hue and chroma. `primary` is the seed's own. */
export const PALETTES = {
  neutral: { hue: 243, chroma: 4 },
  neutralVariant: { hue: 243, chroma: 8 },
  secondary: { hue: 243, chroma: 8 },
};

/**
 * Every role MileWage sets itself, as [palette, tone] per theme, with the reason. Palettes:
 * `neutral` and `secondary` (above), `primary` (the seed's). Everything else is Material's computation.
 */
export const OVERRIDES = {
  primary: {
    light: ['neutral', 15],
    dark: ['neutral', 90],
    why: 'Ink, not gold: text buttons, links, checked controls, progress, the tab indicator and a focused field are Asphalt ink in light and near-white in dark, so the interface is monochrome and the yellow is the one colour.',
  },
  onPrimary: {
    light: ['neutral', 100],
    dark: ['neutral', 10],
    why: 'Follows primary: white on ink, ink on near-white.',
  },
  surfaceTint: {
    light: ['neutral', 15],
    dark: ['neutral', 90],
    why: 'Material tints elevated surfaces with primary; it must be the ink too, or Android elevation turns yellow.',
  },
  onPrimaryContainer: {
    light: ['neutral', 6],
    dark: ['neutral', 6],
    why: "Asphalt on Lane yellow, the logo's own pairing (11:1), instead of Fidelity's brown #6e5100 (4.6:1), which read muddy.",
  },
  onSecondaryContainer: {
    light: ['secondary', 10],
    dark: ['secondary', 90],
    why: "Fidelity derives it at a mid tone (#5f656b, 4.6:1); the label of the active navigation item and of a chosen chip is crisp ink at Material's baseline tones instead.",
  },
  background: {
    light: ['neutral', 95],
    dark: ['neutral', 6],
    why: 'The page. Light: a cool light grey under white cards (surface-container-lowest), so cards read by lightness without a border or a tint. Dark: Asphalt, equal to surface. Material 2021 sets background = surface; Android Scaffold paints background, so this one role carries the page to both apps.',
  },
};

/**
 * Money and signal colours: Material custom colours, not harmonised. Tones are Material's
 * (40 / 100 / 90 / 10 in light, 80 / 20 / 30 / 90 in dark) except where `light` or `dark` says
 * otherwise; the JSON's `customColors.*.tones` has the tones used.
 */
export const CUSTOM = [
  {
    name: 'earned',
    value: '#34D399',
    blend: false,
    dark: { color: 70, on: 10 },
    why: 'Dark colour at tone 70 (Material 80): a green that still reads as green, not mint.',
  },
  {
    name: 'spent',
    value: '#EA6A0A',
    blend: false,
    light: { color: 44 },
    dark: { color: 70, on: 10 },
    why: "Seed moved from #FF6B5E (hue 25, the hue of Material's error) to an orange at hue 47, and the light colour to tone 44, so money out never looks like a destructive action (OKLab distance from error 7 or more in both themes; test/m3-contrast.test.ts). Dark colour at tone 70: Material's 80 is the same pastel as error's #ffb4ab.",
  },
  { name: 'signal', value: '#4C8DFF', blend: false },
];

const TONES = {
  light: { color: 40, on: 100, container: 90, onContainer: 10 },
  dark: { color: 80, on: 20, container: 30, onContainer: 90 },
};

/**
 * Chart colours, for marks on a card (`card`: white in light, surface-container #1e2022 in dark).
 * The categorical set is the data-viz skill's validated reference families (blue, orange, aqua,
 * amber, magenta, green, violet, red) in its CVD-safe order, with the light steps of aqua, amber
 * and magenta darkened until every slot reaches 3:1 on white. Validated with
 * validate_palette.js: adjacent CVD ΔE ≥ 10.4 light / 8.4 dark, normal-vision ≥ 16.7 / 19.3.
 * Assign in order, never cycled; past eight, fold into `other`. The semantic series are roles:
 * money in, money out, and a steel `measure` for distance and time. Grid and axis are the
 * outline roles.
 */
export const CHART = {
  series: {
    light: ['#2a78d6', '#d4561f', '#0f8a72', '#a07000', '#c4487b', '#2f7d00', '#6250d6', '#d03b3b'],
    dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  },
  /** Steel: Asphalt's hue with more chroma, so a distance or time bar is calm but not grey. */
  measure: { hue: 243, chroma: 16, light: 45, dark: 72 },
  /** Everything folded into "Other": the neutral variant palette. */
  other: { light: 60, dark: 45 },
};

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
const palette = ({ hue, chroma }) => TonalPalette.fromHueAndChroma(hue, chroma);

/** One theme's roles as `{ primary: '#25272a', ... }`, the custom colours included. */
function theme(dark) {
  const mode = dark ? 'dark' : 'light';
  const scheme = new DynamicScheme({
    sourceColorHct: Hct.fromInt(argbFromHex(SEED)),
    variant: Variant.FIDELITY,
    contrastLevel: CONTRAST_LEVEL,
    isDark: dark,
    specVersion: SPEC_VERSION,
    neutralPalette: palette(PALETTES.neutral),
    neutralVariantPalette: palette(PALETTES.neutralVariant),
    secondaryPalette: palette(PALETTES.secondary),
  });
  const named = {
    neutral: scheme.neutralPalette,
    secondary: scheme.secondaryPalette,
    primary: scheme.primaryPalette,
  };
  const roles = Object.fromEntries(ROLES.map((r) => [r, hexFromArgb(scheme[r])]));
  for (const [role, o] of Object.entries(OVERRIDES)) {
    const [p, tone] = o[mode];
    roles[role] = hexFromArgb(named[p].tone(tone));
  }
  for (const c of CUSTOM) {
    const p = TonalPalette.fromInt(argbFromHex(c.value));
    const t = { ...TONES[mode], ...c[mode] };
    roles[c.name] = hexFromArgb(p.tone(t.color));
    roles[`on${cap(c.name)}`] = hexFromArgb(p.tone(t.on));
    roles[`${c.name}Container`] = hexFromArgb(p.tone(t.container));
    roles[`on${cap(c.name)}Container`] = hexFromArgb(p.tone(t.onContainer));
  }
  return roles;
}

/** One theme's chart colours, keyed as they are written to CSS (`chart-series-1`, ...). */
function chart(dark, roles) {
  const mode = dark ? 'dark' : 'light';
  const steel = palette(CHART.measure);
  const nv = palette(PALETTES.neutralVariant);
  return {
    ...Object.fromEntries(CHART.series[mode].map((hex, i) => [`series${i + 1}`, hex])),
    earned: roles.earned,
    spent: roles.spent,
    measure: hexFromArgb(steel.tone(CHART.measure[mode])),
    other: hexFromArgb(nv.tone(CHART.other[mode])),
    grid: roles.outlineVariant,
    axis: roles.outline,
  };
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
  const light = theme(false);
  const dark = theme(true);
  return {
    seed: SEED,
    asphalt: ASPHALT,
    variant: VARIANT,
    specVersion: SPEC_VERSION,
    contrastLevel: CONTRAST_LEVEL,
    palettes: PALETTES,
    overrides: Object.fromEntries(
      Object.entries(OVERRIDES).map(([role, o]) => [
        role,
        {
          light: { palette: o.light[0], tone: o.light[1] },
          dark: { palette: o.dark[0], tone: o.dark[1] },
        },
      ]),
    ),
    customColors: Object.fromEntries(
      CUSTOM.map((c) => [
        c.name,
        {
          value: c.value,
          harmonized: c.blend,
          tones: { light: { ...TONES.light, ...c.light }, dark: { ...TONES.dark, ...c.dark } },
        },
      ]),
    ),
    light,
    dark,
    chart: { light: chart(false, light), dark: chart(true, dark) },
  };
}

function block(selector, roles, charts) {
  const lines = Object.entries(roles).map(([role, hex]) => {
    const prefix = customKeys.has(role) ? '--md-extended-color' : '--md-sys-color';
    return `  ${prefix}-${kebab(role)}: ${hex};`;
  });
  const chartLines = Object.entries(charts).map(
    ([k, hex]) => `  --md-extended-color-chart-${kebab(k).replace(/(\D)(\d)/, '$1-$2')}: ${hex};`,
  );
  return `${selector} {\n${[...lines, ...chartLines].join('\n')}\n}\n`;
}

/** The two files, as their text. */
export function buildFiles() {
  const scheme = buildScheme();
  const head =
    `/* Generated by apps/web/scripts/m3-theme.mjs: Lane yellow ${SEED} on Asphalt-hue neutrals ` +
    `(${VARIANT}, spec ${SPEC_VERSION}, with MileWage's overrides). ` +
    'Do not edit; run `npm run theme -w apps/web`. */\n';
  return {
    css:
      `${head}${block(':root', scheme.light, scheme.chart.light)}\n` +
      block('.dark', scheme.dark, scheme.chart.dark),
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
