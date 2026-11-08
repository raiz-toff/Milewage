import { isHomeAddress } from '@milewage/shared';
import type { FetchFn } from '../api/client';

/**
 * Home or away (plan 28 section 4.3). The phone keeps two addresses: the server on the home
 * network (http allowed) and the https one for everywhere else (Tailscale). It uses home when it
 * is on Wi-Fi or Ethernet and the home address answers quickly as the same server; otherwise away.
 * No Wi-Fi name and no location permission: reachability decides, as Plex and Immich's external
 * list do. The choice is remembered for a minute and forgotten when a request gets no answer.
 */

export const PROBE_MS = 1500;
export const REMEMBER_MS = 60_000;

export interface Addresses {
  baseUrl: string;
  homeUrl?: string | null;
  awayUrl?: string | null;
  instanceId: string | null;
}

/** Home and away of a credential, also of one saved before plan 28 (only `baseUrl`). */
export function addressesOf(c: Addresses): { home: string | null; away: string | null } {
  const legacyHome = isHomeAddress(c.baseUrl);
  return {
    home: c.homeUrl ?? (legacyHome ? c.baseUrl : null),
    away: c.awayUrl ?? (legacyHome ? null : c.baseUrl),
  };
}

export type Where = 'home' | 'away';

export interface RouteDeps {
  /** True on Wi-Fi or Ethernet, false on mobile data alone, null when the phone cannot tell. */
  localNetwork(): Promise<boolean | null>;
  /** Whether `url` answers quickly as the server with this instance id (any, when null). */
  probe(url: string, instanceId: string | null): Promise<boolean>;
  now?: () => number;
}

export class RoutePicker {
  private memo: { key: string; url: string; where: Where; at: number } | null = null;
  private lastWhere: Where | null = null;
  private readonly now: () => number;

  constructor(private readonly d: RouteDeps) {
    this.now = d.now ?? Date.now;
  }

  /** Where the last pick went (the banner says "away" things only when away). */
  get where(): Where | null {
    return this.lastWhere;
  }

  async pick(c: Addresses): Promise<{ url: string; where: Where }> {
    const { home, away } = addressesOf(c);
    const chosen = await this.choose(home, away, c.instanceId);
    this.lastWhere = chosen.where;
    return chosen;
  }

  private async choose(home: string | null, away: string | null, instanceId: string | null) {
    if (!home) return { url: away!, where: 'away' as const };
    if (!away) return { url: home, where: 'home' as const };
    const key = `${home} ${away}`;
    const m = this.memo;
    if (m && m.key === key && this.now() - m.at < REMEMBER_MS) return m;
    const local = await this.d.localNetwork();
    const atHome = local !== false && (await this.d.probe(home, instanceId));
    const picked = atHome
      ? { url: home, where: 'home' as const }
      : { url: away, where: 'away' as const };
    this.memo = { key, ...picked, at: this.now() };
    return picked;
  }

  /** A request got no answer: look again next time (walking out of the house switches to away). */
  forget(): void {
    this.memo = null;
  }
}

/**
 * `GET <url>/healthz` within `PROBE_MS`: ok, a MileWage answer (`X-MileWage-Api`), and the same
 * instance (`X-MileWage-Instance`) when the phone knows it. A café Wi-Fi with something else at the
 * same private address fails, so the device token is never sent there.
 */
export function healthProbe(fetchFn: FetchFn, timeoutMs = PROBE_MS) {
  return async (url: string, instanceId: string | null): Promise<boolean> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await Promise.race([
        fetchFn(`${url}/healthz`, { method: 'GET', signal: ctl.signal }),
        new Promise<never>((_, reject) =>
          ctl.signal.addEventListener('abort', () => reject(new Error('timeout'))),
        ),
      ]);
      if (!res.ok || !res.headers.has('X-MileWage-Api')) return false;
      return instanceId === null || res.headers.get('X-MileWage-Instance') === instanceId;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
}
