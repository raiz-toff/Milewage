import type { Schemas } from './api/client';

// Named places (ADR 0008): what the Places page and the stops panel share.

type Role = Schemas['Place']['role'];

/** The radius limits and default the server keeps (ADR 0008). */
export const RADIUS = { min: 25, max: 1000, default: 100 } as const;

export const ROLES: readonly { value: Role; label: string }[] = [
  { value: 'pickup', label: 'Pickup' },
  { value: 'dropoff', label: 'Dropoff' },
  { value: 'other', label: 'Other' },
];

/** What a stop on a shift's page hands over with "Save as a place" (router state, never the URL). */
export interface PlaceDraft {
  lat_e7: number;
  lon_e7: number;
  role: Role;
  name?: string;
}

/** Degrees as the form shows them: five decimals, about a metre. */
export const centreText = (latE7: number, lonE7: number) =>
  `${(latE7 / 1e7).toFixed(5)}, ${(lonE7 / 1e7).toFixed(5)}`;

/** "43.75395, -79.4" to degrees x 1e7; null when it is not a latitude and a longitude. */
export function parseCentre(text: string): { lat_e7: number; lon_e7: number } | null {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat_e7: Math.round(lat * 1e7), lon_e7: Math.round(lon * 1e7) };
}
