import type { Schemas } from '../api/client';

type Shift = Schemas['Shift'];

/** What the driver can do about a check; several checks can share one piece of advice. */
export const PERMISSIONS =
  'In the MileWage phone app, open Permissions: location “Allow all the time” and battery use “unrestricted”, so the phone keeps recording with the screen off.';
const ADVICE: Record<string, string> = {
  low_fix_density: PERMISSIONS,
  tracking_interrupted: PERMISSIONS,
  gap_large: PERMISSIONS,
  gap_dropped: PERMISSIONS,
  poor_accuracy_share: 'Keep the phone where it can see the sky, for example on the dashboard.',
  clock_skew: "Set the phone's date and time to automatic.",
  shift_auto_closed: 'End the shift on the phone when you stop working.',
  phone_missing:
    'Open MileWage on the phone while it has a connection, so it can send anything it still holds.',
};

/** The advice for a shift's checks, each piece once, in the order of the checks. */
export function adviceFor(shift: Shift, extra: string[] = []): string[] {
  const codes = [...(shift.flags ?? []).map((f) => f.code), shift.recon_status ?? ''];
  return [...new Set([...codes.map((c) => ADVICE[c]), ...extra])].filter((a): a is string => !!a);
}
