/**
 * The address a phone is given (plan 19 section 3.2): `MILEWAGE_PUBLIC_URL` or the driver's
 * correction. An absolute https URL with no path, query, fragment or credentials; plain http only
 * when `allowHttp` (a development server, for debug builds of the app).
 * Returns the address without a trailing slash, or the reason it is refused.
 */
export function checkPublicUrl(
  value: string,
  allowHttp: boolean,
): { url: string } | { error: string } {
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    return { error: 'Enter a full address, for example https://milewage-box.tail1234.ts.net' };
  }
  if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) {
    return { error: 'The address must start with https://' };
  }
  if (u.username || u.password) return { error: 'The address must not hold a user name.' };
  if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) {
    return { error: 'Use only the start of the address, with nothing after the host name.' };
  }
  return { url: u.origin };
}

/** Where the address in a pairing code came from (the web explains it to the driver). */
export type BaseUrlSource = 'configured' | 'request' | 'driver';
