import { TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/**
 * Why an address cannot work for the release phone app (plan 19 section 3.3), or null:
 * `local` (this computer only: localhost, 127.x, ::1), `http` (the app connects over https only),
 * `ip` (a bare IP address: this network only, and no https certificate).
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
    title: 'Phones only connect over https',
    text: `Open MileWage at your Tailscale address (https://…ts.net) and pair from there. To set it up, see ${GUIDE}.`,
  },
  ip: {
    title: 'This address only works on this network',
    text: `It stops working when your phone is on mobile data, and the app needs an https name. Set up Tailscale first: see ${GUIDE}.`,
  },
};

/** The warning shown before a code whose address will not work on the phone (plan 19 section 3.3). */
export function AddressWarning({ problem }: { problem: AddressProblem }) {
  if (!problem) return null;
  const { title, text } = WORDS[problem];
  return (
    <Alert role="note" className="border-primary/40 bg-primary/5">
      <TriangleAlert aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="text-foreground">{text}</AlertDescription>
    </Alert>
  );
}
