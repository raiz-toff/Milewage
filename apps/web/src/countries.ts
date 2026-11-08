import type { Schemas } from './api/client';
import { useApiQuery } from './api/query';

export type Country = Schemas['Country'];

/** The server's country tree (`GET /countries`, public); empty until it arrives or if it fails. */
export function useCountries(): Country[] {
  // The tree only changes with a server upgrade. On a failure screens fall back to the codes
  // they already have.
  return useApiQuery('/countries', undefined, { staleTime: Infinity }).data ?? NONE;
}
const NONE: Country[] = [];

/** `Province` from `province`; the country's own word for its regions (libaddressinput). */
export const levelWord = (c: Country | undefined) => {
  const w = c?.labels.region ?? 'region';
  return w.charAt(0).toUpperCase() + w.slice(1);
};
