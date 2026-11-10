/**
 * A platform's colour as Material draws a custom colour (m3.material.io, custom colours; the same
 * tones `earned` and `spent` use): the colour's hue and chroma at tone 40 with tone 100 letters in
 * the light theme, at tone 80 with tone 20 letters in the dark. The driver's colour is data and
 * stays as stored; only how it is drawn follows the theme, so the letters keep at least 4.5:1 and
 * the badge stands off the page in both themes.
 *
 * Tone is CIE L*, as in Material's HCT, so the contrast follows from the tones alone. Hue and chroma
 * are CIELAB's (LCh), close to HCT's for this use; the build-time material-color-utilities is not
 * shipped to the browser for one badge. The colour is not harmonised toward the brand yellow:
 * Material leaves brand colours unharmonised, and a platform's colour is how the driver tells it apart.
 */

type Lab = [number, number, number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

// D65 white point.
const WHITE = [0.95047, 1, 1.08883] as const;
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116);
const fInv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));

function labOf(hex: string): Lab {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255)) as [
    number,
    number,
    number,
  ];
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / WHITE[0];
  const y = (0.2126729 * r + 0.7151522 * g + 0.072175 * b) / WHITE[1];
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / WHITE[2];
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** Linear sRGB of a Lab colour; channels may fall outside 0..1 when it is out of gamut. */
function linearOf([l, a, b]: Lab): [number, number, number] {
  const fy = (l + 16) / 116;
  const x = fInv(fy + a / 500) * WHITE[0];
  const y = (l > 8 ? fy ** 3 : l / (24389 / 27)) * WHITE[1];
  const z = fInv(fy - b / 200) * WHITE[2];
  return [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
}

const inGamut = (rgb: number[]) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

function hexOf(rgb: number[]): string {
  return `#${rgb
    .map((c) =>
      Math.round(fromLinear(Math.min(1, Math.max(0, c))) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** `hex` at another tone (L*), its hue kept, its chroma lowered only as far as sRGB needs. */
export function atTone(hex: string, tone: number): string {
  const [, a, b] = labOf(hex);
  const chroma = Math.hypot(a, b);
  const hue = Math.atan2(b, a);
  const at = (c: number): Lab => [tone, c * Math.cos(hue), c * Math.sin(hue)];
  if (inGamut(linearOf(at(chroma)))) return hexOf(linearOf(at(chroma)));
  let [lo, hi] = [0, chroma];
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(linearOf(at(mid)))) lo = mid;
    else hi = mid;
  }
  return hexOf(linearOf(at(lo)));
}

export interface BadgeColours {
  light: { bg: string; fg: string };
  dark: { bg: string; fg: string };
}

const cache = new Map<string, BadgeColours>();

/** The badge's fill and letters in each theme, from the platform's colour. */
export function badgeColours(hex: string): BadgeColours {
  const key = hex.toLowerCase();
  let found = cache.get(key);
  if (!found) {
    found = {
      light: { bg: atTone(key, 40), fg: atTone(key, 100) },
      dark: { bg: atTone(key, 80), fg: atTone(key, 20) },
    };
    cache.set(key, found);
  }
  return found;
}
