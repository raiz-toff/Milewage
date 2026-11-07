// Built-in delivery platforms (18 section 4.2, 08 section 16.3): data, not code. Which ones a
// country or region offers is its `platforms` slot (plan 21). The driver's own overrides and custom
// platforms live in the `platform_settings` table.

export interface BuiltinPlatform {
  slug: string;
  label: string;
}

export const BUILTIN_PLATFORMS: readonly BuiltinPlatform[] = [
  { slug: 'doordash', label: 'DoorDash' },
  { slug: 'ubereats', label: 'Uber Eats' },
  { slug: 'skipthedishes', label: 'SkipTheDishes' },
  { slug: 'foodora', label: 'Foodora' },
  { slug: 'instacart', label: 'Instacart' },
  { slug: 'amazonflex', label: 'Amazon Flex' },
  { slug: 'grubhub', label: 'Grubhub' },
  { slug: 'deliveroo', label: 'Deliveroo' },
  { slug: 'justeat', label: 'Just Eat' },
  { slug: 'other', label: 'Other' },
];

export const builtinPlatform = (slug: string) => BUILTIN_PLATFORMS.find((p) => p.slug === slug);

/** Words the web uses for a unit of work on a platform ("block" for Amazon Flex); display only. */
export const PLATFORM_VOCABULARY: Readonly<Record<string, string>> = { amazonflex: 'block' };

export const CUSTOM_SLUG = /^[a-z0-9_]{1,32}$/;
