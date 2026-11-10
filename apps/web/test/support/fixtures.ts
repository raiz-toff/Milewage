import type { Schemas } from '../../src/api/client';

/** API-shaped records for the screen tests. */
export const shift = (over: object = {}) => ({
  id: 1,
  client_id: '00000000-0000-4000-8000-000000000001',
  vehicle_id: 1,
  status: 'ended',
  segmenter: 'stops',
  started_at: 1_700_000_000_000,
  ended_at: 1_700_003_600_000,
  local_date: '2023-11-14',
  total_m: 5000,
  active_m: 3000,
  deadhead_m: 2000,
  personal_m: 0,
  calc_version: 3,
  calculated_at: 1,
  notes: null,
  deduction_cents: null,
  flags: [],
  ...over,
});

export const trip = (id: number, over: object = {}) => ({
  id,
  shift_id: 1,
  trip_key: `k${id}`,
  kind: 'active',
  original_kind: 'active',
  source: 'auto',
  started_at: 1_700_000_000_000 + id * 600_000,
  ended_at: 1_700_000_000_000 + id * 600_000 + 300_000,
  distance_m: id * 1000,
  purpose: '',
  edited_at: null,
  ...over,
});

export const stop = (n: number, over: Partial<Schemas['Stop']> = {}): Schemas['Stop'] => ({
  stop_key: `00000000-0000-4000-8000-000000000001:${1_700_000_000_000 + n * 600_000}:stop`,
  shift_id: 1,
  started_at: 1_700_000_000_000 + n * 600_000,
  ended_at: 1_700_000_000_000 + n * 600_000 + 180_000,
  dwell_s: 180,
  lat_e7: 450_000_000,
  lon_e7: -750_000_000,
  confidence: 'high',
  est_role: 'pickup',
  role: 'pickup',
  label: null,
  place: null,
  ...over,
});

const place = (code: string, name: string, own_rules = false) => ({
  code,
  name,
  own_rules,
  verified: false,
  cities: [],
});
const country = (code: string, name: string, over: Partial<Schemas['Country']> = {}) => ({
  code,
  name,
  currency: 'USD',
  unit: 'mi' as const,
  labels: { region: 'state', city: null },
  supports: { mileage: true, tax: false },
  verified: false,
  work: ['delivery' as const],
  regional_rules: false,
  regions: [],
  ...over,
});

/** `GET /countries`, shortened: a few regions each. */
export const countriesFixture = (): Schemas['Country'][] => [
  country('US', 'United States', { regions: [place('NY', 'New York')] }),
  country('CA', 'Canada', {
    currency: 'CAD',
    unit: 'km',
    labels: { region: 'province', city: null },
    supports: { mileage: true, tax: true },
    regional_rules: true,
    regions: [place('AB', 'Alberta'), place('ON', 'Ontario', true), place('QC', 'Quebec', true)],
  }),
  country('GB', 'United Kingdom', {
    currency: 'GBP',
    labels: { region: 'nation', city: null },
    regions: [place('ENG', 'England')],
  }),
];
