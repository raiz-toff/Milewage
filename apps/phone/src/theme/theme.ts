import { PALETTE, type Palette } from './colors';

export type { Palette };

/** The palette. The phone has one theme, dark ("default in the car"). */
export function useColors(): Palette {
  return PALETTE;
}
