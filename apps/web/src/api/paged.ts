import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

/** One page of a keyset-paged list, as `/expenses`, `/notifications` and `/shifts` answer. */
export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

/** Rows asked for per page, and the most one request may ask for (the routes' `limit` maximum). */
const PAGE = 50;
const MAX = 200;

/**
 * A list read with the server's `cursor` / `next_cursor`, shown as one list that grows by a page
 * on `showMore`. Like the week of Shifts, it is one query that follows the cursors itself, keyed
 * `[path, params, { pages }]`: after a change (every read is invalidated) every shown row is read
 * again, and another `params` (a new filter) starts again at one page. The shown rows stay
 * while the next page is read.
 */
export function usePagedList<T>(
  key: readonly [string, object],
  fetchPage: (page: { limit: number; cursor?: string }, signal: AbortSignal) => Promise<Page<T>>,
  options: { enabled?: boolean } = {},
) {
  const id = JSON.stringify(key);
  const [shown, setShown] = useState({ id, pages: 1 });
  const pages = shown.id === id ? shown.pages : 1;
  const query = useQuery({
    queryKey: [...key, { pages }],
    queryFn: async ({ signal }) => {
      const items: T[] = [];
      let left = pages * PAGE;
      let cursor: string | undefined;
      do {
        const page = await fetchPage(
          { limit: Math.min(left, MAX), ...(cursor ? { cursor } : {}) },
          signal,
        );
        items.push(...page.items);
        left -= page.items.length;
        cursor = page.next_cursor ?? undefined;
        if (page.items.length === 0) break;
      } while (cursor && left > 0);
      return { items, more: cursor !== undefined };
    },
    placeholderData: keepPreviousData,
    ...options,
  });
  return {
    items: query.data?.items ?? null,
    /** Whether the server has rows after the shown ones. */
    more: query.data?.more ?? false,
    /** True while the next page is read. */
    loadingMore: query.isFetching && pages > 1 && query.isPlaceholderData,
    showMore: () => setShown({ id, pages: pages + 1 }),
    error: query.error,
  };
}
