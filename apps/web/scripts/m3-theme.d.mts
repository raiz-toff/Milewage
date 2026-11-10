/** Types of scripts/m3-theme.mjs, for the tests that import it. */
export declare const SEED: string;
export declare const VARIANT: string;
export declare const SPEC_VERSION: string;
export declare const CONTRAST_LEVEL: number;
export declare const ROLES: string[];
export declare const CUSTOM: { name: string; value: string; blend: boolean }[];
export interface M3Scheme {
  seed: string;
  variant: string;
  specVersion: string;
  contrastLevel: number;
  customColors: Record<string, { value: string; harmonized: boolean }>;
  light: Record<string, string>;
  dark: Record<string, string>;
}
export declare function buildScheme(): M3Scheme;
export declare function buildFiles(): { css: string; json: string };
export declare const OUT: { css: string; json: string };
