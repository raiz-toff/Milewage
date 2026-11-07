import * as React from 'react';
import { Text as RNText } from 'react-native';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

// shadcn/ui typography (React Native Reusables), in Geist. Weights are font families on Android.
const textVariants = cva('font-sans text-base text-foreground', {
  variants: {
    variant: {
      default: '',
      h1: 'font-sans-semibold text-3xl tracking-tight',
      h2: 'font-sans-semibold text-2xl tracking-tight',
      h3: 'font-sans-semibold text-xl tracking-tight',
      h4: 'font-sans-semibold text-lg tracking-tight',
      p: 'leading-7',
      lead: 'text-xl text-muted-foreground',
      large: 'font-sans-semibold text-lg',
      small: 'font-sans-medium text-sm leading-none',
      muted: 'text-sm text-muted-foreground',
      label: 'font-sans-medium text-sm',
      caption: 'font-sans-medium text-xs text-muted-foreground',
      mono: 'font-mono text-xs text-muted-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});

/** Lets a parent (a button, a badge) set the text style of its children. */
const TextClassContext = React.createContext<string | undefined>(undefined);

type TextProps = React.ComponentProps<typeof RNText> &
  VariantProps<typeof textVariants> & {
    className?: string;
    /** Tabular figures for distances, times and money, so columns line up. */
    tabular?: boolean;
  };

function Text({ className, variant, tabular, style, ...props }: TextProps) {
  const inherited = React.useContext(TextClassContext);
  return (
    <RNText
      className={cn(textVariants({ variant }), inherited, className)}
      style={tabular ? [{ fontVariant: ['tabular-nums'] }, style] : style}
      {...props}
    />
  );
}

export { Text, TextClassContext, textVariants };
