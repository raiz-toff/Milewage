#!/usr/bin/env node
/* global console, process, URL */
// Prints the colour tables of references/tokens.md from apps/web/src/theme/m3-scheme.json, so the
// guide's values are never typed by hand. Run from the repository root after
// `npm run theme -w apps/web`, and paste the output over the tables between "## Colour roles"
// and "## shadcn names":
//   node .claude/skills/milewage-design/scripts/tokens-table.mjs
import { readFileSync } from 'node:fs';

const root = new URL('../../../../', import.meta.url);
const scheme = JSON.parse(readFileSync(new URL('apps/web/src/theme/m3-scheme.json', root), 'utf8'));
const { light, dark, chart, overrides } = scheme;

const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/(\D)(\d)/, '$1-$2');
const code = (s) => `\`${s}\``;

/** A markdown table with every column padded, as prettier writes it. */
function table(head, rows) {
  const all = [head, ...rows];
  const w = head.map((_, i) => Math.max(3, ...all.map((r) => r[i].length)));
  const line = (r) => `| ${r.map((c, i) => c.padEnd(w[i])).join(' | ')} |`;
  return [line(head), `| ${w.map((n) => '-'.repeat(n)).join(' | ')} |`, ...rows.map(line)].join(
    '\n',
  );
}

const TAILWIND = {
  secondary: 'md-secondary',
  scrim: 'scrim',
};
const NOTE = {
  primary: 'ink',
  onPrimaryContainer: 'Asphalt',
  primaryContainer: 'Lane yellow',
  background: 'the page',
  tertiary: 'unused',
};
const MAIN = [
  'background',
  'surface',
  'surfaceContainerLowest',
  'surfaceContainerLow',
  'surfaceContainer',
  'surfaceContainerHigh',
  'surfaceContainerHighest',
  'surfaceVariant',
  'surfaceDim',
  'surfaceBright',
  'onSurface',
  'onSurfaceVariant',
  'outline',
  'outlineVariant',
  'primary',
  'onPrimary',
  'primaryContainer',
  'onPrimaryContainer',
  'inversePrimary',
  'secondary',
  'onSecondary',
  'secondaryContainer',
  'onSecondaryContainer',
  'tertiary',
  'onTertiary',
  'tertiaryContainer',
  'onTertiaryContainer',
  'error',
  'onError',
  'errorContainer',
  'onErrorContainer',
  'inverseSurface',
  'inverseOnSurface',
  'surfaceTint',
  'scrim',
];
const roleRows = MAIN.map((r) => {
  const notes = [NOTE[r], overrides[r] && 'override'].filter(Boolean);
  const name = kebab(r) + (notes.length ? ` (${notes.join(', ')})` : '');
  const tw = r === 'surfaceTint' ? '(CSS variable only)' : code(TAILWIND[r] ?? kebab(r));
  return [name, tw, code(light[r]), code(dark[r])];
});
const fixed = Object.keys(light).filter((k) => /Fixed/.test(k));
const fixedRows = fixed.map((r) => [kebab(r), code(light[r]), code(dark[r])]);

const money = ['earned', 'spent', 'signal'].flatMap((n) => {
  const cap = n[0].toUpperCase() + n.slice(1);
  return [n, `on${cap}`, `${n}Container`, `on${cap}Container`].map((r) => [
    kebab(r),
    code(kebab(r)),
    code(light[r]),
    code(dark[r]),
  ]);
});

const chartRows = Object.keys(chart.light).map((k) => [
  code(`chart-${kebab(k)}`),
  code(chart.light[k]),
  code(chart.dark[k]),
]);

const overrideRows = Object.entries(overrides).map(([r, o]) => [
  kebab(r),
  `${o.light.palette} ${o.light.tone}`,
  `${o.dark.palette} ${o.dark.tone}`,
]);

const out = [
  '### Material roles',
  '',
  table(['Role', 'Tailwind', 'Light', 'Dark'], roleRows),
  '',
  '### Fixed roles (the same in both themes; CSS variables only)',
  '',
  table(['Role', 'Light', 'Dark'], fixedRows),
  '',
  '### Extended colours (Material custom colours, not harmonised)',
  '',
  table(['Role', 'Tailwind', 'Light', 'Dark'], money),
  '',
  '### Chart colours (`--md-extended-color-chart-*`, Tailwind `chart-*`)',
  '',
  table(['Token', 'Light', 'Dark'], chartRows),
  '',
  '### Overrides (palette and tone per theme)',
  '',
  table(['Role', 'Light', 'Dark'], overrideRows),
];
process.stdout.write(`${out.join('\n')}\n`);
