import { isHomeAddress } from './home-address';

/**
 * The pairing code's link format (08 section 2.4, plan 24 Q1, plan 28), written once for the
 * server that makes the code, the web page a camera app opens and the phone that reads it.
 *
 * Two forms carry the same facts:
 * - the app link `milewage://pair?v=1&u=<server address>&t=<mwp_ code>[&h=<home address>]`, which
 *   opens the phone app;
 * - the page link `<server address>/pair#v=1&t=<mwp_ code>[&h=<home address>]`, which the QR
 *   shows. The phone app reads it too; any other camera opens the server's pair page. The code is
 *   in the fragment, so no server log sees it, and the server address is the page's own.
 *
 * `u` is the address the server put in the code: its away address when it has one, else its home
 * address. `h` (plan 28) is the home address, present only when it differs from `u`; an older app
 * ignores it. Written without `URL` and `URLSearchParams` so the phone (Hermes) runs the same code.
 */
export interface PairingLink {
  /** `u`: the server address in the code, without a trailing slash. */
  baseUrl: string;
  /** `t`: the one-time pairing code, `mwp_` and base64url characters. */
  token: string;
  /** `h`: the server on the home network. Only ever a home address; absent when there is none. */
  homeUrl?: string;
}

const ADDRESS = /^https?:\/\/[^\s/?#]+(:\d+)?(\/[^\s?#]*)?$/;
const TOKEN = /^mwp_[A-Za-z0-9_-]{10,}$/;
const PAGE = /^(https?:\/\/[^\s/?#]+(?:\/[^\s?#]*?)?)\/pair\/?#(.*)$/;
const APP = /^milewage:\/\/pair\?(.*)$/;

const trim = (address: string) => address.replace(/\/+$/, '');

/** Both forms of one pairing code: the app link and the page link the QR shows. */
export function pairingLinks(link: PairingLink): { appLink: string; pageUrl: string } {
  const base = trim(link.baseUrl);
  const home = link.homeUrl ? trim(link.homeUrl) : '';
  const t = `t=${encodeURIComponent(link.token)}`;
  const h = home && home !== base ? `&h=${encodeURIComponent(home)}` : '';
  return {
    appLink: `milewage://pair?v=1&u=${encodeURIComponent(base)}&${t}${h}`,
    pageUrl: `${base}/pair#v=1&${t}${h}`,
  };
}

/**
 * Reads either form. Returns null for anything else, another version included, so a scan of a
 * stray QR does nothing. In the page form a `u` inside the fragment is overridden by the page's
 * own address. An `h` that is not a home address is dropped.
 */
export function parsePairingLink(text: string): PairingLink | null {
  const trimmed = text.trim();
  const page = PAGE.exec(trimmed);
  const query = page ? `${page[2]}&u=${encodeURIComponent(page[1]!)}` : APP.exec(trimmed)?.[1];
  if (query === undefined) return null;
  const params = new Map<string, string>();
  for (const pair of query.split('&')) {
    const i = pair.indexOf('=');
    if (i < 0) return null;
    try {
      params.set(pair.slice(0, i), decodeURIComponent(pair.slice(i + 1)));
    } catch {
      return null;
    }
  }
  const u = params.get('u');
  const t = params.get('t');
  if (params.get('v') !== '1' || !u || !t || !TOKEN.test(t) || !ADDRESS.test(u)) return null;
  const h = params.get('h');
  const home = h && ADDRESS.test(h) && isHomeAddress(h) ? trim(h) : undefined;
  return { baseUrl: trim(u), token: t, ...(home ? { homeUrl: home } : {}) };
}
