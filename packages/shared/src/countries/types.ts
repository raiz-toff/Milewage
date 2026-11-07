// The country contract (plan 21 section 3). A country is data plus its own calculation; regions
// and cities add only the data that differs from the level above. Nothing here is a compliance
// claim: a rate is a published figure with its source, not advice (17 R9).

import type { PlaceData } from './slots';

export type VehicleKind =
  'car' | 'motorcycle' | 'van' | 'bicycle' | 'ebike' | 'scooter' | 'walking';

/** Not an automobile: no mileage allowance rate applies (18 section 4.1). */
export const notAutomobile = (kind: VehicleKind) =>
  kind === 'bicycle' || kind === 'ebike' || kind === 'scooter' || kind === 'walking';

export interface DeductionInput {
  /** Business metres of the trip, shift or period slice being valued. */
  totalM: number;
  /** Business metres already driven in the same rate period (calendar year, tax year) before this slice. */
  priorM: number;
  /** Local date `YYYY-MM-DD` of the shift. */
  date: string;
  vehicleKind: VehicleKind;
}

/**
 * A rate that changes over time, in the OpenFisca parameter shape: `values` keyed by the date each
 * value starts. The value at a date is the last one that started on or before it. A final `null`
 * ends the parameter (OpenFisca does the same), so a rate is never carried into a period nobody
 * announced.
 */
export interface Dated<T> {
  label: string;
  /** For example `cents/km`, `cents/mi`, `bp` (basis points), `cents`. */
  unit: string;
  /** Where the values come from (a URL). */
  reference: readonly string[];
  values: Readonly<Record<string, T | null>>;
}

/** Level words from libaddressinput's `state_name_type`; `nation` (GB) is ours: it has none. */
export type RegionLabel = 'province' | 'state' | 'island' | 'area' | 'county' | 'nation';
/** From libaddressinput's `locality_name_type` list. */
export type CityLabel = 'city' | 'district' | 'post_town' | 'suburb';

/** A region (ISO 3166-2, `CA-QC`) or a city (`US-NY-NYC`: region + UN/LOCODE location part). */
export interface Place {
  code: string;
  /** The level above: the country (`CA`) or a region (`US-NY`). */
  parent: string;
  name: string;
  /** Only what differs from the parent. */
  data?: PlaceData;
  sources?: readonly string[];
  /** Missing means not checked by a person. */
  verified?: boolean;
  notes?: readonly string[];
}

export interface CountryModule {
  /** ISO 3166-1 alpha-2, upper case. The name comes from `countryName()`, never written here. */
  code: string;
  /** ISO 4217. */
  currency: string;
  unit: 'km' | 'mi';
  labels: { region?: RegionLabel; city?: CityLabel };
  places: readonly Place[];
  /** National values of the data slots; regions and cities are in `places`. */
  data: PlaceData;
  /** Where the figures come from, and what has not been checked by a person. */
  sources: readonly string[];
  /** False until a person has compared every figure with the primary page (17 section 4). */
  verified: boolean;
  notes: readonly string[];
}

export interface ResolvedPlace {
  country: CountryModule;
  /** From the country down: `['CA', 'CA-ON']`. */
  codes: readonly string[];
  data: PlaceData;
  /** True only if every level that supplied data was checked by a person. */
  verified: boolean;
  sources: readonly string[];
  notes: readonly string[];
}
