import { useColorScheme } from 'react-native';
import { colors, type ColorTokens } from '@milewage/shared';

/** Colours for the current system scheme. Dark is the default when the scheme is unknown. */
export function useTheme(): ColorTokens {
  return useColorScheme() === 'light' ? colors.light : colors.dark;
}
