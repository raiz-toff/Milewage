import { Linking } from 'react-native';
import { httpAllowed, isHomeAddress } from '@milewage/shared';
import { loadNetCheck } from '../../native/net-check';

/** Plan 19 section 3.5: say which step is wrong instead of "Cannot reach the server". */

export const TAILSCALE = 'com.tailscale.ipn';

/** Phone side of the tailnet: whether a VPN is on, and Tailscale itself. */
export interface NetPort {
  /** True when this phone's traffic goes through a VPN; null when it cannot tell. */
  vpnActive(): Promise<boolean | null>;
  /** True on Wi-Fi or Ethernet, false on mobile data alone, null when it cannot tell (plan 28). */
  localNetwork(): Promise<boolean | null>;
  tailscaleInstalled(): Promise<boolean>;
  /** Opens Tailscale, or its store page when it is not installed. */
  openTailscale(): Promise<void>;
}

export const nativeNet = (): NetPort => ({
  vpnActive: async () => loadNetCheck()?.vpnActive() ?? null,
  localNetwork: async () => loadNetCheck()?.localNetwork() ?? null,
  tailscaleInstalled: async () => loadNetCheck()?.isInstalled(TAILSCALE) ?? false,
  openTailscale: async () => {
    if (loadNetCheck()?.openApp(TAILSCALE)) return;
    await Linking.openURL(`market://details?id=${TAILSCALE}`).catch(() =>
      Linking.openURL(`https://play.google.com/store/apps/details?id=${TAILSCALE}`),
    );
  },
});

const host = (url: string) => /^https?:\/\/(\[[^\]]+\]|[^/:?#]+)/i.exec(url)?.[1]?.toLowerCase();

export const isTailnetAddress = (url: string) => !!host(url)?.endsWith('.ts.net');

/** Before connecting, with no network call: an address this phone can never use. */
export function addressProblem(baseUrl: string, release: boolean): string | null {
  const h = host(baseUrl) ?? '';
  if (h === 'localhost' || h.startsWith('127.') || h === '[::1]') {
    return "This code points at the computer that made it, not your server. Make the code from your server's https address.";
  }
  // Plain http only on the home network (owner decision 2026-11-08, plan 28).
  if (release && !httpAllowed(baseUrl)) {
    return 'This code uses an unsecured address (http) outside your home network. Open MileWage in your browser at its https address, or at its address on your home Wi-Fi, and make a new code.';
  }
  return null;
}

export interface Failure {
  text: string;
  /** Show "Open Tailscale" with the message. */
  tailscale?: boolean;
}

const PROBLEMS: Record<string, string> = {
  invalid_pairing_token: 'This code is not valid, has expired or was already used. Make a new one.',
  rate_limited: 'Too many attempts. Wait a few minutes and try again.',
  not_milewage: 'That address answered, but it is not a MileWage server.',
  network: 'Cannot reach the server. Check the address and your connection.',
  insecure_address:
    'This address uses plain http outside your home network. Use its https address instead.',
};

/** When connecting failed. `vpn` is read only for a network failure to a `.ts.net` address. */
export function explainFailure(code: string, baseUrl: string, vpn: boolean | null): Failure {
  // At home there is no Tailscale to blame (plan 28): say what a home address needs.
  if (code === 'network' && isHomeAddress(baseUrl)) {
    return {
      text: `Can't reach your server at ${baseUrl}. Check that this phone is on the same Wi-Fi as the server and that the server is on.`,
    };
  }
  if (code === 'network' && isTailnetAddress(baseUrl)) {
    if (vpn === false) {
      return {
        text: 'Tailscale is off on this phone. Open Tailscale, connect, then try again.',
        tailscale: true,
      };
    }
    if (vpn === true) {
      return {
        text: 'Your server is not answering through Tailscale. Check that the server is on and that the phone and server are signed in to the same Tailscale account.',
      };
    }
    return {
      text: "Can't reach your server. Is Tailscale connected on this phone?",
      tailscale: true,
    };
  }
  return { text: PROBLEMS[code] ?? 'Connecting failed. Check the address and try again.' };
}
