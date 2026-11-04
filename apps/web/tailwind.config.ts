import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';
import { colors, fonts } from '../../packages/shared/src/tokens';

/** CSS variable block for one theme; every colour in the app comes from the shared tokens. */
const vars = (c: typeof colors.dark) => ({
  '--mw-bg': c.background,
  '--mw-card': c.card,
  '--mw-border': c.border,
  '--mw-text': c.text,
  '--mw-muted': c.textMuted,
  '--mw-accent': c.accent,
});

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--mw-bg)',
        card: 'var(--mw-card)',
        line: 'var(--mw-border)',
        ink: 'var(--mw-text)',
        muted: 'var(--mw-muted)',
        accent: 'var(--mw-accent)',
      },
      fontFamily: {
        heading: [`"${fonts.heading}"`, 'serif'],
        sans: [`"${fonts.body}"`, 'system-ui', 'sans-serif'],
        mono: [`"${fonts.mono}"`, 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [
    // Dark is the product default (05 section 1.1); light follows the OS preference.
    plugin(({ addBase }) =>
      addBase({
        ':root': { ...vars(colors.dark), colorScheme: 'dark' },
        '@media (prefers-color-scheme: light)': {
          ':root': { ...vars(colors.light), colorScheme: 'light' },
        },
      }),
    ),
  ],
} satisfies Config;
