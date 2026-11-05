// Built-in delivery platforms (18 section 4.2, 08 section 16.3): data, not code. The driver's own
// overrides and custom platforms live in the `platform_settings` table.

export interface BuiltinPlatform {
  slug: string;
  label: string;
  /** Countries whose default list shows it; `other` is in every list. */
  countries: readonly string[];
}

export const BUILTIN_PLATFORMS: readonly BuiltinPlatform[] = [
  { slug: 'doordash', label: 'DoorDash', countries: ['CA', 'US'] },
  { slug: 'ubereats', label: 'Uber Eats', countries: ['CA', 'US', 'GB'] },
  { slug: 'skipthedishes', label: 'SkipTheDishes', countries: ['CA'] },
  { slug: 'foodora', label: 'Foodora', countries: ['CA'] },
  { slug: 'instacart', label: 'Instacart', countries: ['CA', 'US'] },
  { slug: 'amazonflex', label: 'Amazon Flex', countries: ['CA', 'US', 'GB'] },
  { slug: 'grubhub', label: 'Grubhub', countries: ['US'] },
  { slug: 'deliveroo', label: 'Deliveroo', countries: ['GB'] },
  { slug: 'justeat', label: 'Just Eat', countries: ['GB'] },
  { slug: 'other', label: 'Other', countries: ['CA', 'US', 'GB'] },
];

export const builtinPlatform = (slug: string) => BUILTIN_PLATFORMS.find((p) => p.slug === slug);

/** Words the web uses for a unit of work on a platform ("block" for Amazon Flex); display only. */
export const PLATFORM_VOCABULARY: Readonly<Record<string, string>> = { amazonflex: 'block' };

export const CUSTOM_SLUG = /^[a-z0-9_]{1,32}$/;
