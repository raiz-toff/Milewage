import { useEffect, useState } from 'react';
import { unwrap } from './api/client';
import type { Schemas } from './api/client';
import { useSession } from './session';

export type Country = Schemas['Country'];

/** The server's country tree (`GET /countries`, public); empty until it arrives or if it fails. */
export function useCountries(): Country[] {
  const { api } = useSession();
  const [list, setList] = useState<Country[]>([]);
  useEffect(() => {
    let live = true;
    unwrap(api.GET('/countries'))
      .then((l) => live && setList(l))
      .catch(() => {}); // screens fall back to the codes they already have
    return () => {
      live = false;
    };
  }, [api]);
  return list;
}

/** `Province` from `province`; the country's own word for its regions (libaddressinput). */
export const levelWord = (c: Country | undefined) => {
  const w = c?.labels.region ?? 'region';
  return w.charAt(0).toUpperCase() + w.slice(1);
};
