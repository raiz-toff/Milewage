// Built-in delivery platforms (18 section 4.2, 08 section 16.3): data, not code. Which ones a
// country or region offers is its `platforms` slot (plan 21). The driver's own overrides and custom
// platforms live in the `platform_settings` table. Badge colours and letters: plan 25.

export interface BuiltinPlatform {
  slug: string;
  label: string;
  /** Brand colour of the platform's badge (plan 25 section 4.3); null: the theme's neutral. */
  color: string | null;
  /** One or two letters for the badge. MileWage ships no platform logos (plan 25 section 5). */
  initials: string;
}

export const BUILTIN_PLATFORMS: readonly BuiltinPlatform[] = [
  { slug: 'doordash', label: 'DoorDash', color: '#FF3008', initials: 'DD' },
  { slug: 'ubereats', label: 'Uber Eats', color: '#06C167', initials: 'UE' },
  { slug: 'skipthedishes', label: 'SkipTheDishes', color: '#FF8000', initials: 'S' },
  { slug: 'foodora', label: 'Foodora', color: '#D70F64', initials: 'F' },
  { slug: 'instacart', label: 'Instacart', color: '#43B02A', initials: 'I' },
  { slug: 'amazonflex', label: 'Amazon Flex', color: '#232F3E', initials: 'AF' },
  { slug: 'grubhub', label: 'Grubhub', color: '#FF8000', initials: 'G' },
  { slug: 'deliveroo', label: 'Deliveroo', color: '#00CCBC', initials: 'D' },
  { slug: 'justeat', label: 'Just Eat', color: '#FF8000', initials: 'JE' },
  { slug: 'other', label: 'Other', color: null, initials: '…' },
];

export const builtinPlatform = (slug: string) => BUILTIN_PLATFORMS.find((p) => p.slug === slug);

/** Words the web uses for a unit of work on a platform ("block" for Amazon Flex); display only. */
export const PLATFORM_VOCABULARY: Readonly<Record<string, string>> = { amazonflex: 'block' };

export const CUSTOM_SLUG = /^[a-z0-9_]{1,32}$/;
