// Chart colours are the generated chart tokens (scripts/m3-theme.mjs, tokens.md), read as CSS
// variables so light and dark follow the theme with no code. Never a hex here, never primary,
// never the brand yellow.

const v = (name: string) => `var(--md-extended-color-chart-${name})`;

export const chartColor = {
  /** Money in. */
  earned: v('earned'),
  /** Money out. */
  spent: v('spent'),
  /** Distance and time: the steel. */
  measure: v('measure'),
  /**
   * Personal distance beside the steel business kinds: categorical slot 7, because three greys
   * cannot be told apart (validated: active, deadhead and personal clear CVD ΔE 8 in both themes).
   */
  personal: v('series-7'),
  /** The folded tail, the previous period, everything that is context rather than the point. */
  other: v('other'),
  grid: v('grid'),
  axis: v('axis'),
  /** The surface a chart sits on (the card), for the 2 px gaps and rings between marks. */
  surface: 'var(--card)',
} as const;

/** Categorical slot `n` (1 to 8), assigned in order for identity; past eight it is `other`. */
export const seriesColor = (n: number) => (n >= 1 && n <= 8 ? v(`series-${n}`) : chartColor.other);

/**
 * A lighter step of a token for a second part of the same thing (tips under pay, deadhead beside
 * active, a heat cell): the colour mixed with the card in OKLab, so it is one hue at another
 * lightness in both themes. `pct` is how much of the colour is kept.
 */
export const tint = (color: string, pct: number) =>
  `color-mix(in oklab, ${color} ${pct}%, ${chartColor.surface})`;
