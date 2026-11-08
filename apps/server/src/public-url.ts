import { isHomeAddress } from '@milewage/shared';

/**
 * The address a phone is given (plan 19 section 3.2): `MILEWAGE_PUBLIC_URL` or the driver's
 * correction. An absolute https URL with no path, query, fragment or credentials; plain http only
 * when `allowHttp` (a development server, for debug builds of the app) or, when `homeHttp`, to a
 * home address (plan 28 section 4.1: the phone may use http only on the home network).
 * Returns the address without a trailing slash, or the reason it is refused.
 */
export function checkPublicUrl(
  value: string,
  allowHttp: boolean,
  homeHttp = false,
): { url: string } | { error: string } {
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    return { error: 'Enter a full address, for example https://milewage-box.tail1234.ts.net' };
  }
  const http = u.protocol === 'http:' && (allowHttp || (homeHttp && isHomeAddress(u.href)));
  if (u.protocol !== 'https:' && !http) {
    return {
      error: homeHttp
        ? 'The address must start with https://, or be on your home network (for example http://192.168.1.20:8080)'
        : 'The address must start with https://',
    };
  }
  if (u.username || u.password) return { error: 'The address must not hold a user name.' };
  if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) {
    return { error: 'Use only the start of the address, with nothing after the host name.' };
  }
  return { url: u.origin };
}

/** `MILEWAGE_HOME_URL` (plan 28 section 4.2): the server on the home network, http or https. */
export function checkHomeUrl(value: string): { url: string } | { error: string } {
  const checked = checkPublicUrl(value, false, true);
  if ('error' in checked) return checked;
  if (!isHomeAddress(checked.url)) {
    return {
      error:
        'The home address must be on your home network: a private address such as http://192.168.1.20:8080 or a .local name.',
    };
  }
  return checked;
}

/** Where the address in a pairing code came from (the web explains it to the driver). */
export type BaseUrlSource = 'configured' | 'request' | 'driver';
