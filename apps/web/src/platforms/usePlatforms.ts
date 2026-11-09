import { useCallback } from 'react';
import { builtinPlatform } from '@milewage/shared';
import type { Schemas } from '../api/client';
import { useApiQuery } from '../api/query';
import { useSettings } from '../session';
import type { PlatformLike } from './PlatformBadge';

/**
 * A platform by slug for a badge and its name: the driver's list (switched-off ones too, for past
 * figures), else the built-in name, else the slug itself.
 */
export function usePlatformOf(): (slug: string) => PlatformLike {
  const { modules } = useSettings();
  // Names and colours are a nicety: on a failure the slug still shows.
  const list =
    useApiQuery(
      '/platforms',
      { params: { query: { include_inactive: true } } },
      { enabled: modules.platforms },
    ).data ?? NONE;
  return useCallback(
    (slug: string) =>
      list.find((p) => p.slug === slug) ?? { slug, label: builtinPlatform(slug)?.label ?? slug },
    [list],
  );
}
const NONE: Schemas['Platform'][] = [];

/** The slug of a platform the driver names; empty when the name has no letters or digits. */
export const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
