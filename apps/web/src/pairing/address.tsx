import { WarningIcon } from '@/ui/icons';
import { isHomeAddress } from '@milewage/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/**
 * Why an address cannot work for the release phone app (plan 19 section 3.3), or null:
 * `local` (this computer only: localhost, 127.x, ::1), `http` (plain http to an address that is
 * not on the home network), `ip` (a bare public IP address over https: no certificate for it).
 * A home address (plan 28: private ranges, .local, .lan, .home.arpa) is fine, http or https.
 */
export type AddressProblem = 'local' | 'http' | 'ip' | null;

export function addressProblem(address: string): AddressProblem {
  let u: URL;
  try {
    u = new URL(address);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '0.0.0.0')
    return 'local';
  if (/^127\.\d+\.\d+\.\d+$/.test(host)) return 'local';
  if (isHomeAddress(address)) return null;
  if (u.protocol === 'http:') return 'http';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) return 'ip';
  return null;
}

/** Where the install guide explains Tailscale; there is no public guide address yet (todo). */
const GUIDE = 'the install guide, section 3 (infra/docs/install.md in the MileWage files)';

const WORDS: Record<Exclude<AddressProblem, null>, { title: string; text: string }> = {
  local: {
    title: 'This address only works on this computer',
    text: `Your phone cannot reach it. Set up Tailscale first, then open MileWage at its https://…ts.net address: see ${GUIDE}.`,
  },
  http: {
    title: 'Phones use plain http only on your home network',
    text: `This address is not on your home network. Open MileWage at its https address (Tailscale, https://…ts.net) or at its home address (for example http://192.168.1.20:8080) and pair from there. See ${GUIDE}.`,
  },
  ip: {
    title: 'The app needs an https name for this address',
    text: `There is no https certificate for a bare address outside your home network. Set up Tailscale and use its https://…ts.net name: see ${GUIDE}.`,
  },
};

/** The warning shown before a code whose address will not work on the phone (plan 19 section 3.3). */
export function AddressWarning({ problem }: { problem: AddressProblem }) {
  if (!problem) return null;
  const { title, text } = WORDS[problem];
  return (
    <Alert role="note">
      <WarningIcon aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="text-foreground">{text}</AlertDescription>
    </Alert>
  );
}
