import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND, PALETTE, type Palette } from '../src/theme/colors';

/**
 * The MileWage palette lives twice: CSS variables for class names (src/global.css) and a hex
 * mirror for icons and the navigator (src/theme/colors.ts). This fails when the two drift apart.
 */
const css = readFileSync(join(__dirname, '../src/global.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('\n  }', start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([\d.]+ [\d.]+% [\d.]+%)/g)].map((m) => [m[1]!, m[2]!]),
  );
}

function hsl(text: string): [number, number, number] {
  const [h, s, l] = text.split(' ').map((v) => parseFloat(v)) as [number, number, number];
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const PAIRS: [keyof Palette, string][] = [
  ['background', 'background'],
  ['foreground', 'foreground'],
  ['card', 'card'],
  ['primary', 'primary'],
  ['primaryForeground', 'primary-foreground'],
  ['secondary', 'secondary'],
  ['muted', 'muted'],
  ['mutedForeground', 'muted-foreground'],
  ['accent', 'accent'],
  ['destructive', 'destructive'],
  ['border', 'border'],
  ['input', 'input'],
  ['ring', 'ring'],
  ['signal', 'signal'],
  ['earned', 'earned'],
  ['spent', 'spent'],
];

describe('palette matches global.css', () => {
  const vars = block(':root');
  it.each(PAIRS)('%s', (key, cssVar) => {
    const [r, g, b] = hsl(vars[cssVar]!);
    const [er, eg, eb] = rgb(PALETTE[key]);
    // HSL to one decimal place rounds a unit or two either way.
    expect(Math.abs(r - er)).toBeLessThanOrEqual(2);
    expect(Math.abs(g - eg)).toBeLessThanOrEqual(2);
    expect(Math.abs(b - eb)).toBeLessThanOrEqual(2);
  });
});

it('keeps the brand colours of the MileWage palette', () => {
  expect(BRAND).toEqual({
    laneYellow: '#FFC21F',
    asphalt: '#101214',
    signalBlue: '#4C8DFF',
    earned: '#34D399',
    spent: '#FF6B5E',
  });
  expect(PALETTE).toMatchObject({
    background: '#101214',
    card: '#181B1E',
    border: '#262A2F',
    mutedForeground: '#8B939C',
    foreground: '#ECEEF0',
  });
});
