import type { CSSProperties, ReactNode } from 'react';
import { builtinPlatform } from '@milewage/shared';
import { cn } from '@/lib/utils';
import { PLATFORM_MARKS, SHOW_PLATFORM_LOGOS } from './logos';

/** What a badge needs: a row of `GET /platforms`, or a slug and its name. */
export interface PlatformLike {
  slug: string;
  label: string;
  /** The driver's own colour (`platform_settings.color`), `#rrggbb`. */
  color?: string | null;
  emoji?: string | null;
}

/**
 * Colours for a custom platform without its own (plan 25 section 4.2): not the brand's yellow or
 * blue, not Earned green or Spent red; each passes 4.5:1 with white letters.
 */
export const CUSTOM_COLORS = [
  '#0F766E',
  '#6D28D9',
  '#A21CAF',
  '#475569',
  '#92400E',
  '#0E7490',
] as const;

const INK = '#101214';
const WHITE = '#FFFFFF';

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG contrast ratio of two `#rrggbb` colours. */
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** White or asphalt, whichever reads better on `bg`. */
export const inkOn = (bg: string) => (contrast(bg, WHITE) >= contrast(bg, INK) ? WHITE : INK);

/** A custom platform's colour when the driver set none: the same slug always gets the same one. */
export function customColor(slug: string) {
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CUSTOM_COLORS[h % CUSTOM_COLORS.length]!;
}

/** "Spark Driver" → "SD", "Lyft" → "L". */
export function initialsOf(label: string) {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((w) => [...w][0])
    .join('')
    .toUpperCase();
}

export type BadgeLook = { bg: string | null; fg: string | null } & (
  { kind: 'mark'; path: string } | { kind: 'emoji' | 'initials'; text: string }
);

/** What the badge shows for a platform (plan 25 section 4.1). `bg` null: the theme's neutral. */
export function platformLook(p: PlatformLike, logos = SHOW_PLATFORM_LOGOS): BadgeLook {
  const built = builtinPlatform(p.slug);
  const own = p.color && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : null;
  const bg = own ?? (built ? built.color : customColor(p.slug));
  const fg = bg ? inkOn(bg) : null;
  if (p.emoji) return { kind: 'emoji', text: p.emoji, bg, fg };
  const path = logos && built?.logo ? PLATFORM_MARKS[p.slug] : undefined;
  if (path) return { kind: 'mark', path, bg, fg };
  return { kind: 'initials', text: built ? built.initials : initialsOf(p.label), bg, fg };
}

/**
 * A platform's badge: its mark, emoji or initials on its colour. Hidden from screen readers, because
 * the name is written next to it; `labelled` names it, for a badge on its own.
 */
export function PlatformBadge({
  platform,
  size = 'sm',
  labelled = false,
  className,
}: {
  platform: PlatformLike;
  size?: 'sm' | 'md';
  labelled?: boolean;
  className?: string;
}) {
  const look = platformLook(platform);
  const style: CSSProperties | undefined = look.bg
    ? { backgroundColor: look.bg, color: look.fg!, boxShadow: `inset 0 0 0 1px ${look.fg}1f` }
    : undefined;
  return (
    <span
      {...(labelled ? { role: 'img', 'aria-label': platform.label } : { 'aria-hidden': true })}
      data-platform={platform.slug}
      data-look={look.kind}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md leading-none font-semibold select-none',
        size === 'sm' ? 'size-5 text-[9px]' : 'size-7 text-xs',
        look.bg === null && 'bg-muted text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]',
        className,
      )}
      style={style}
    >
      {look.kind === 'mark' ? (
        <svg viewBox="0 0 24 24" className="size-[60%]" fill="currentColor" aria-hidden>
          <path d={look.path} />
        </svg>
      ) : look.kind === 'emoji' ? (
        <span className={size === 'sm' ? 'text-xs' : 'text-base'}>{look.text}</span>
      ) : (
        look.text
      )}
    </span>
  );
}

/** The badge and the platform's name, side by side: the usual way to show a platform. */
export function PlatformName({
  platform,
  size,
  className,
  children,
}: {
  platform: PlatformLike;
  size?: 'sm' | 'md';
  className?: string;
  /** Shown instead of the plain name (e.g. the name with a figure). */
  children?: ReactNode;
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <PlatformBadge platform={platform} size={size} />
      <span className="min-w-0">{children ?? platform.label}</span>
    </span>
  );
}
