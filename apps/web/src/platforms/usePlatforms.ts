import { useCallback, useEffect, useState } from 'react';
import { builtinPlatform } from '@milewage/shared';
import { unwrap } from '../api/client';
import type { Schemas } from '../api/client';
import { useSession, useSettings } from '../session';
import type { PlatformLike } from './PlatformBadge';

/**
 * A platform by slug for a badge and its name: the driver's list (switched-off ones too, for past
 * figures), else the built-in name, else the slug itself.
 */
export function usePlatformOf(): (slug: string) => PlatformLike {
  const { api } = useSession();
  const { modules } = useSettings();
  const [list, setList] = useState<Schemas['Platform'][]>([]);
  useEffect(() => {
    if (!modules.platforms) return;
    let live = true;
    void unwrap<Schemas['Platform'][]>(
      api.GET('/platforms', { params: { query: { include_inactive: true } } }),
    )
      .then((l) => live && setList(l))
      .catch(() => {}); // names and colours are a nicety; the slug still shows
    return () => {
      live = false;
    };
  }, [api, modules.platforms]);
  return useCallback(
    (slug: string) =>
      list.find((p) => p.slug === slug) ?? { slug, label: builtinPlatform(slug)?.label ?? slug },
    [list],
  );
}
