import { combineData, type PlaceData } from './slots';
import type { CountryModule, Place, ResolvedPlace } from './types';

/** `CA-ON` from `ON` (how settings store a region today); a full code is kept as it is. */
export const placeCode = (country: CountryModule, code: string) =>
  code.startsWith(`${country.code}-`) ? code : `${country.code}-${code}`;

/** The chain from the place up to (not including) the country, or empty when the place is unknown. */
function chain(country: CountryModule, code: string): Place[] {
  const byCode = new Map(country.places.map((p) => [p.code, p]));
  const out: Place[] = [];
  for (let p = byCode.get(code); p; p = byCode.get(p.parent)) {
    if (out.includes(p)) return []; // a loop; the conformance test reports it
    out.unshift(p);
  }
  return out[0]?.parent === country.code ? out : [];
}

/** The country's data, then each level below it, slot by slot. Unknown place: national only. */
export function resolvePlace(country: CountryModule, code?: string | null): ResolvedPlace {
  const levels = code ? chain(country, placeCode(country, code)) : [];
  let data: PlaceData = country.data;
  let verified = country.verified;
  const sources = [...country.sources];
  const notes = [...country.notes];
  for (const p of levels) {
    if (p.data) {
      data = combineData(data, p.data);
      verified &&= p.verified === true;
    }
    sources.push(...(p.sources ?? []));
    notes.push(...(p.notes ?? []));
  }
  return {
    country,
    codes: [country.code, ...levels.map((p) => p.code)],
    data,
    verified,
    sources,
    notes,
  };
}
