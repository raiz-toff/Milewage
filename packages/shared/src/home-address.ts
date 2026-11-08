/**
 * Home addresses (plan 28 section 4.1, owner decision 2026-11-08): the only places a phone may use
 * plain http. Private IPv4 (RFC 1918), IPv4 link-local, IPv6 unique local (fc00::/7) and link-local
 * (fe80::/10), and the names `*.local` (RFC 6762), `*.lan` and `*.home.arpa` (RFC 8375).
 * `localhost` and loopback are not home addresses: they are "this computer". Written without `URL`
 * so the phone (Hermes, whose URL has no `hostname`) runs the same code as the server and the web.
 */

const ADDRESS = /^(https?):\/\/(?:[^@/?#]*@)?(\[[^\]]+\]|[^/:?#]+)(?::(\d+))?(?:[/?#]|$)/i;

/** The scheme and host of an http(s) address (IPv6 without brackets, lower case), or null. */
export function addressParts(url: string): { scheme: 'http' | 'https'; host: string } | null {
  const m = ADDRESS.exec(url.trim());
  if (!m) return null;
  const host = m[2]!.toLowerCase().replace(/^\[|\]$/g, '');
  return { scheme: m[1]!.toLowerCase() as 'http' | 'https', host };
}

function ipv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

/** True for a host on the home network (see above); false for anything else, loopback included. */
export function isHomeHost(host: string): boolean {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/%.*$/, '') // IPv6 zone id
    .replace(/\.$/, ''); // a fully qualified name may end in a dot
  const v4 = ipv4(h) ?? ipv4(/^::ffff:([\d.]+)$/.exec(h)?.[1] ?? '');
  if (v4) {
    const [a, b] = v4 as [number, number];
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (h.includes(':')) {
    if (!/^[0-9a-f:.]+$/.test(h)) return false;
    const first = parseInt(h.startsWith(':') ? '0' : h.split(':')[0]!, 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
  }
  return (
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(h) &&
    /\.(local|lan|home\.arpa)$/.test(h)
  );
}

/** An http(s) address whose host is on the home network. */
export function isHomeAddress(url: string): boolean {
  const p = addressParts(url);
  return !!p && isHomeHost(p.host);
}

/** https always; plain http only to a home address (owner decision 2026-11-08). */
export function httpAllowed(url: string): boolean {
  const p = addressParts(url);
  if (!p) return false;
  return p.scheme === 'https' || isHomeHost(p.host);
}
