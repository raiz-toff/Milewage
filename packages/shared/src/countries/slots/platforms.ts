// Slot `platforms`: the delivery apps offered at a place, by slug from the shared list
// (`platforms.ts` keeps only slug, label and vocabulary). Every level adds to the list above it;
// `available: false` takes one away (a region where an app does not run).

import { builtinPlatform } from '../../platforms';

export interface PlatformOffer {
  slug: string;
  available?: false;
}

export function combinePlatforms(
  parent: readonly PlatformOffer[] | undefined,
  own: readonly PlatformOffer[],
): readonly PlatformOffer[] {
  let out = [...(parent ?? [])];
  for (const o of own) {
    out = out.filter((p) => p.slug !== o.slug);
    if (o.available !== false) out.push(o);
  }
  return out;
}

export function platformsProblems(offers: readonly PlatformOffer[]): string[] {
  const seen = new Set<string>();
  return offers.flatMap((o) => {
    const problem = !builtinPlatform(o.slug)
      ? [`platform ${o.slug} is not in the shared list`]
      : seen.has(o.slug)
        ? [`platform ${o.slug} listed twice`]
        : [];
    seen.add(o.slug);
    return problem;
  });
}

/** Slugs from a list of slugs, in order: `offer('doordash', 'other')`. */
export const offer = (...slugs: string[]): PlatformOffer[] => slugs.map((slug) => ({ slug }));
