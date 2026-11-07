// Data slots (plan 21 section 3.4). A slot is one kind of regional data; the slot decides how a
// level combines with the one above. A new slot is one file here plus one line in each table.

import { logbookProblems, type Logbook } from './logbook';
import { pensionProblems, type Pension } from './pension';
import { combinePlatforms, platformsProblems, type PlatformOffer } from './platforms';
import { combineSalesTax, salesTaxProblems, type SalesTaxComponent } from './sales-tax';

export * from './logbook';
export * from './pension';
export * from './platforms';
export * from './sales-tax';

export interface PlaceData {
  salesTax?: readonly SalesTaxComponent[];
  pension?: Pension | null;
  platforms?: readonly PlatformOffer[];
  logbook?: Logbook;
}

type Slots = Required<PlaceData>;

/** The nearest level that sets the slot wins, including an explicit `null`. */
const nearest = <T>(_parent: T | undefined, own: T): T => own;

export const SLOT_COMBINE: {
  [K in keyof Slots]: (parent: Slots[K] | undefined, own: Slots[K]) => Slots[K];
} = { salesTax: combineSalesTax, pension: nearest, platforms: combinePlatforms, logbook: nearest };

export const SLOT_PROBLEMS: { [K in keyof Slots]: (value: Slots[K]) => string[] } = {
  salesTax: salesTaxProblems,
  pension: pensionProblems,
  platforms: platformsProblems,
  logbook: logbookProblems,
};

/** Adds one level's data on top of the data resolved so far. */
export function combineData(above: PlaceData, own: PlaceData): PlaceData {
  const out: Record<string, unknown> = { ...above };
  for (const key of Object.keys(own) as (keyof Slots)[]) {
    const combine = SLOT_COMBINE[key] as (p: unknown, o: unknown) => unknown;
    out[key] = combine(out[key], own[key]);
  }
  return out as PlaceData;
}

/** Problems in one level's data, by slot. */
export function dataProblems(data: PlaceData): string[] {
  return (Object.keys(data) as (keyof Slots)[]).flatMap((key) => {
    const check = SLOT_PROBLEMS[key] as ((v: unknown) => string[]) | undefined;
    return check ? check(data[key]) : [`unknown slot ${key}`];
  });
}
