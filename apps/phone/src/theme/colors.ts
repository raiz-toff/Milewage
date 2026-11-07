/**
 * Hex mirror of src/global.css (the MileWage brand palette) for places class names cannot reach:
 * icon colours, the native navigator, placeholder text. test/tokens.test.ts checks the mirror.
 * The phone is always dark: it is the in-car app.
 */

export interface Palette {
  background: string;
  foreground: string;
  card: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  destructive: string;
  border: string;
  input: string;
  ring: string;
  /** Live position only. */
  signal: string;
  /** Money in. */
  earned: string;
  /** Money out. */
  spent: string;
}

export const BRAND = {
  laneYellow: '#FFC21F',
  asphalt: '#101214',
  signalBlue: '#4C8DFF',
  earned: '#34D399',
  spent: '#FF6B5E',
} as const;

export const PALETTE: Palette = {
  background: '#101214',
  foreground: '#ECEEF0',
  card: '#181B1E',
  primary: BRAND.laneYellow,
  primaryForeground: BRAND.asphalt,
  secondary: '#262A2F',
  muted: '#262A2F',
  mutedForeground: '#8B939C',
  accent: '#262A2F',
  destructive: BRAND.spent,
  border: '#262A2F',
  input: '#262A2F',
  ring: BRAND.laneYellow,
  signal: BRAND.signalBlue,
  earned: BRAND.earned,
  spent: BRAND.spent,
};
