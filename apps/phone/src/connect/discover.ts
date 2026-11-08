import { isHomeHost } from '@milewage/shared';

/**
 * MileWage servers found on the Wi-Fi (plan 28 section 4.5). The server announces
 * `_milewage._tcp` over mDNS with TXT `v=1`, `id=<instance id>` and `path=/`; the phone browses
 * with Android's NsdManager (`native/net-check`). Only home addresses are kept: an announcement
 * cannot point the phone at the internet, and http goes only to home addresses anyway.
 */

export const SERVICE_TYPE = '_milewage._tcp';
/** How long the phone listens for announcements before showing what it found. */
export const BROWSE_MS = 4000;

export interface FoundServer {
  /** The announced name, e.g. "MileWage (box)". */
  name: string;
  /** `http://<address>:<port>`, a home address. */
  url: string;
  /** The server's instance id; null before its owner account exists. */
  instanceId: string | null;
}

export interface Announcement {
  name: string;
  host: string;
  port: number;
  txt: Record<string, string>;
}

export function serversFrom(list: Announcement[]): FoundServer[] {
  const seen = new Set<string>();
  const out: FoundServer[] = [];
  for (const a of list) {
    if ((a.txt.v ?? '1') !== '1') continue; // a later record version this app cannot read
    if (!isHomeHost(a.host) || !Number.isInteger(a.port) || a.port < 1 || a.port > 65535) continue;
    const host = a.host.includes(':') ? `[${a.host}]` : a.host;
    const url = `http://${host}:${a.port}`;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ name: a.name.slice(0, 63), url, instanceId: a.txt.id || null });
  }
  return out;
}
