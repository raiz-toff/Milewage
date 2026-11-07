import { useColorScheme } from 'react-native';
import { colors, type ColorTokens } from '@milewage/shared';
import { PALETTE, type Palette } from './colors';

export type { Palette };

/** Colours for the current system scheme. Dark is the default when the scheme is unknown. */
export function useTheme(): ColorTokens {
  return useColorScheme() === 'light' ? colors.light : colors.dark;
}

/** The MileWage palette. The phone has one theme, dark ("default in the car"). */
export function useColors(): Palette {
  return PALETTE;
}
