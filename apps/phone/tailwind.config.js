/**
 * MileWage's Tailwind theme for the phone: the brand palette (src/global.css) under shadcn/ui's
 * colour names and radius scale, plus `signal` (live position), `earned` and `spent` (money).
 * Geist is the typeface; on Android each weight is its own font file, so weights are families.
 * @type {import('tailwindcss').Config}
 */
const v = (name) => `hsl(var(--${name}) / <alpha-value>)`;

module.exports = {
  content: ['./index.ts', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        border: v('border'),
        input: v('input'),
        ring: v('ring'),
        background: v('background'),
        foreground: v('foreground'),
        primary: { DEFAULT: v('primary'), foreground: v('primary-foreground') },
        secondary: { DEFAULT: v('secondary'), foreground: v('secondary-foreground') },
        destructive: { DEFAULT: v('destructive'), foreground: v('destructive-foreground') },
        muted: { DEFAULT: v('muted'), foreground: v('muted-foreground') },
        accent: { DEFAULT: v('accent'), foreground: v('accent-foreground') },
        popover: { DEFAULT: v('popover'), foreground: v('popover-foreground') },
        card: { DEFAULT: v('card'), foreground: v('card-foreground') },
        signal: v('signal'),
        earned: v('earned'),
        spent: v('spent'),
      },
      // The web's --radius is 0.625rem (10 px); sm/md/xl/2xl follow its multipliers.
      borderRadius: { sm: '6px', md: '8px', lg: '10px', xl: '14px', '2xl': '18px' },
      fontFamily: {
        sans: ['Geist_400Regular'],
        'sans-medium': ['Geist_500Medium'],
        'sans-semibold': ['Geist_600SemiBold'],
        'sans-bold': ['Geist_700Bold'],
        mono: ['GeistMono_400Regular'],
      },
    },
  },
  plugins: [],
};
