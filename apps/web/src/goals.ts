import {
  distanceInput,
  formatDistance,
  formatMoney,
  moneyInput,
  parseMoney,
  toMetres,
} from './format';
import type { DistanceUnit } from './format';

/**
 * A goal's target and progress in the driver's units. The server stores a target per metric in
 * its own unit: minor units of the currency (earnings), minutes (hours), a count (shifts) or metres
 * (active distance).
 */

/** Target typed by the driver to the stored unit; NaN when it is not a number above zero. */
export function targetOf(
  metric: string,
  text: string,
  unit: DistanceUnit,
  currency: string,
): number {
  const n = Number(text.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return NaN;
  if (metric === 'earnings') return parseMoney(text, currency);
  if (metric === 'hours') return Math.round(n * 60);
  if (metric === 'active_distance') return toMetres(n, unit);
  return Math.round(n);
}

/** A stored target as the number the form field shows: the inverse of `targetOf`. */
export function targetInput(
  metric: string,
  v: number,
  unit: DistanceUnit,
  currency: string,
): string {
  if (metric === 'earnings') return moneyInput(v, currency);
  if (metric === 'hours') return String(Math.round((v / 60) * 100) / 100);
  if (metric === 'active_distance') return distanceInput(v, unit, 3);
  return String(v);
}

/** Shows a value in the unit the driver typed it in. */
export function valueText(metric: string, v: number, unit: DistanceUnit, currency: string): string {
  if (metric === 'earnings') return formatMoney(v, currency);
  if (metric === 'hours') return `${(v / 60).toFixed(1)} h`;
  if (metric === 'active_distance') return formatDistance(v, unit);
  return String(v);
}
