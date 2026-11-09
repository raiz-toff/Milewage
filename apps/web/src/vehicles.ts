import type { Schemas } from './api/client';

type Vehicle = Schemas['Vehicle'];
type Kind = Vehicle['kind'];
type Ownership = Vehicle['ownership'];

/** The kinds of vehicle, as the driver picks them. */
export const KINDS: { value: Kind; label: string }[] = [
  { value: 'car', label: 'Car' },
  { value: 'van', label: 'Van' },
  { value: 'motorcycle', label: 'Motorcycle' },
  { value: 'bicycle', label: 'Bicycle' },
  { value: 'ebike', label: 'E-bike' },
  { value: 'scooter', label: 'Scooter' },
  { value: 'walking', label: 'On foot' },
];
export const kindLabel = (k: Kind) => KINDS.find((x) => x.value === k)?.label ?? k;

/** 21 section 3.6c: a record for the driver; no rate or tax rule reads it. */
export const OWNERSHIP: { value: Ownership; label: string }[] = [
  { value: 'owned', label: 'Owned' },
  { value: 'financed', label: 'Financed (loan or hire purchase)' },
  { value: 'leased', label: 'Leased' },
  { value: 'rented', label: 'Rented' },
];
/** Shown on the card only when the vehicle is not owned outright. */
export const ownershipNote = (o: Ownership) =>
  o === 'owned' ? '' : (OWNERSHIP.find((x) => x.value === o)?.label ?? '');
