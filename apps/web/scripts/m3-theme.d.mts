/** Types of scripts/m3-theme.mjs, for the tests that import it. */
export declare const SEED: string;
export declare const ASPHALT: string;
export declare const VARIANT: string;
export declare const SPEC_VERSION: string;
export declare const CONTRAST_LEVEL: number;
export declare const ROLES: string[];
export type PaletteName = 'neutral' | 'secondary' | 'primary';
export declare const PALETTES: Record<string, { hue: number; chroma: number }>;
export declare const OVERRIDES: Record<
  string,
  { light: [PaletteName, number]; dark: [PaletteName, number]; why: string }
>;
type Tones = { color: number; on: number; container: number; onContainer: number };
export declare const CUSTOM: {
  name: string;
  value: string;
  blend: boolean;
  light?: Partial<Tones>;
  dark?: Partial<Tones>;
  why?: string;
}[];
export declare const CHART: {
  series: { light: string[]; dark: string[] };
  measure: { hue: number; chroma: number; light: number; dark: number };
  other: { light: number; dark: number };
};
export type ChartColours = Record<
  | `series${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`
  | 'earned'
  | 'spent'
  | 'measure'
  | 'other'
  | 'grid'
  | 'axis',
  string
>;
export interface M3Scheme {
  seed: string;
  asphalt: string;
  variant: string;
  specVersion: string;
  contrastLevel: number;
  palettes: Record<string, { hue: number; chroma: number }>;
  overrides: Record<
    string,
    { light: { palette: PaletteName; tone: number }; dark: { palette: PaletteName; tone: number } }
  >;
  customColors: Record<
    string,
    { value: string; harmonized: boolean; tones: { light: Tones; dark: Tones } }
  >;
  light: Record<string, string>;
  dark: Record<string, string>;
  chart: { light: ChartColours; dark: ChartColours };
}
export declare function buildScheme(): M3Scheme;
export declare function buildFiles(): { css: string; json: string };
export declare const OUT: { css: string; json: string };
