/**
 * Design tokens (05 section 1.1). Values come from Comma's brand system; never invent a hex
 * code outside this file. Dark is the product default. In the light theme accents flip to
 * their 600/700 twins so they pass contrast on white (05 section 1.1 rule 4).
 */
export interface ColorTokens {
  /** Page background. */
  background: string;
  /** Cards and raised surfaces. */
  card: string;
  /** Hairlines and borders. */
  border: string;
  text: string;
  textMuted: string;
  /** Hero accent: earnings, active status. */
  accent: string;
}

export const darkColors: ColorTokens = {
  background: '#0A0A0C',
  card: '#16161A',
  border: '#2E2E36',
  text: '#F6F6F7',
  textMuted: '#9B9BA4',
  accent: '#22c55e',
};

export const lightColors: ColorTokens = {
  background: '#FCFCFD',
  card: '#FCFCFD',
  border: '#E5E5EB',
  text: '#0E0E11',
  textMuted: '#53535A',
  accent: '#15803D',
};

export const colors = { dark: darkColors, light: lightColors } as const;

/** Typefaces (05 section 1.1 rule 2). */
export const fonts = {
  heading: 'DM Serif Display',
  body: 'DM Sans',
  mono: 'DM Mono',
} as const;

/** Touch targets in dp (05 section 2.1). */
export const touchTarget = { min: 48, primary: 56 } as const;
