import { useQuery } from '@tanstack/react-query';
import { useSession } from '../session';
import { apiKey } from './query';
import { unwrap } from './client';
import type { Schemas } from './client';

export type HealthReport = Schemas['HealthReport'];

/** A check that is not ok: the navigation shows a dot while any is. */
export const needsAttention = (report: HealthReport | undefined) =>
  report?.checks.some((c) => c.status !== 'ok') ?? false;

/**
 * The server's health checks and update state. The page's own clock goes with every request (the
 * server compares it with its own), so the time is taken when the request is made, not when the
 * screen is. The key is the plain path, so a change to any record asks again like any other read.
 * A failed read is quiet: the dot and the banner simply do not show.
 */
export function useHealth() {
  const { api } = useSession();
  return useQuery<HealthReport>({
    queryKey: apiKey('/health/checks'),
    queryFn: ({ signal }) =>
      unwrap<HealthReport>(
        api.GET('/health/checks', { params: { query: { client_time: Date.now() } }, signal }),
      ),
    staleTime: 5 * 60_000,
  });
}
