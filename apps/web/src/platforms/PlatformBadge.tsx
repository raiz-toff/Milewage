import type { CSSProperties, ReactNode } from 'react';
import { builtinPlatform } from '@milewage/shared';
import { cn } from '@/lib/utils';
import { badgeColours } from './tones';
import type { BadgeColours } from './tones';

/** What a badge needs: a row of `GET /platforms`, or a slug and its name. */
export interface PlatformLike {
  slug: string;
  label: string;
  /** The driver's own colour (`platform_settings.color`), `#rrggbb`. */
  color?: string | null;
  emoji?: string | null;
}

/**
 * The colours a driver can pick for a platform's badge (Settings > Platforms), each with a name
 * for screen readers. They are stored as given; the badge draws each one at Material's custom-colour
 * tones for the theme (`tones.ts`).
 */
export const PRESET_COLORS = [
  { name: 'Red', color: '#dc2626' },
  { name: 'Orange', color: '#ea580c' },
  { name: 'Green', color: '#16a34a' },
  { name: 'Teal', color: '#0f766e' },
  { name: 'Cyan', color: '#0e7490' },
  { name: 'Blue', color: '#2563eb' },
  { name: 'Violet', color: '#6d28d9' },
  { name: 'Magenta', color: '#a21caf' },
  { name: 'Slate', color: '#475569' },
] as const;

/**
 * Colours for a custom platform without its own (plan 25 section 4.2): not the brand's yellow or
 * blue, not Earned green or Spent red.
 */
export const CUSTOM_COLORS = [
  '#0f766e',
  '#6d28d9',
  '#a21caf',
  '#475569',
  '#92400e',
  '#0e7490',
] as const;

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

export interface BadgeLook {
  kind: 'emoji' | 'initials';
  /** The emoji or the letters. */
  text: string;
  /** The platform's colour as stored or built in; null: the theme's neutral. */
  color: string | null;
  /** How it is drawn in each theme (`tones.ts`); null with the neutral. */
  tones: BadgeColours | null;
}

/**
 * What the badge shows for a platform (plan 25 section 4.1): the driver's emoji, else initials.
 * MileWage shows no platform's logo (owner decision, plan 25 section 5).
 */
export function platformLook(p: PlatformLike): BadgeLook {
  const built = builtinPlatform(p.slug);
  const own = p.color && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : null;
  const color = own ?? (built ? built.color : customColor(p.slug));
  const tones = color ? badgeColours(color) : null;
  if (p.emoji) return { kind: 'emoji', text: p.emoji, color, tones };
  return { kind: 'initials', text: built ? built.initials : initialsOf(p.label), color, tones };
}

/**
 * A platform's badge: the driver's emoji or initials on its colour. Hidden from screen readers, because
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
  const style = look.tones
    ? ({
        '--badge-bg': look.tones.light.bg,
        '--badge-fg': look.tones.light.fg,
        '--badge-bg-dark': look.tones.dark.bg,
        '--badge-fg-dark': look.tones.dark.fg,
      } as CSSProperties)
    : undefined;
  return (
    <span
      {...(labelled ? { role: 'img', 'aria-label': platform.label } : { 'aria-hidden': true })}
      data-platform={platform.slug}
      data-look={look.kind}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[22%] leading-none select-none',
        size === 'sm' ? 'size-5 text-label-small' : 'size-7 text-label-medium',
        look.tones
          ? 'bg-(--badge-bg) text-(--badge-fg) dark:bg-(--badge-bg-dark) dark:text-(--badge-fg-dark)'
          : 'bg-surface-container-highest text-on-surface-variant shadow-[inset_0_0_0_1px_var(--color-outline-variant)]',
        className,
      )}
      style={style}
    >
      {look.kind === 'emoji' ? (
        <span className={size === 'sm' ? 'text-body-small' : 'text-body-large'}>{look.text}</span>
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
