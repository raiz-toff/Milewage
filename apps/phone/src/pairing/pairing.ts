import { isHomeAddress, type PairingLink } from '@milewage/shared';
import { ApiClient, ApiError, type FetchFn } from '../api/client';
import type { RoutePicker } from '../connect/route';
import { DeviceSession, haltFor } from './deviceSession';

/** Async key-value storage. The secure one is Keystore-backed; the plain one holds caches. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.data.set(key, value);
  }
  async remove(key: string) {
    this.data.delete(key);
  }
}

/** An http(s) address with no query or fragment, as the server answers its home and away ones. */
const ADDRESS = /^https?:\/\/[^\s/?#]+(:\d+)?(\/[^\s?#]*)?$/;

/** The slice of `GET /settings` the phone acts on. Unknown members are ignored. */
export interface CachedSettings {
  country: string;
  distance_unit: 'km' | 'mi';
  currency: string;
  timezone: string;
  stops_enabled: boolean;
  engine_version: number;
  diagnostics: { level: 'off' | 'basic' | 'verbose'; verbose_until: number | null };
  modules: Record<string, boolean>;
  /** Absent from servers before plan 21 (J4b, J8): read as none. */
  region?: string | null;
  own_mileage_rate?: { cents_per_unit: number; unit: 'km' | 'mi' } | null;
  mileage_rate?: 'official' | 'yours' | 'none';
}

/** What the screens read to hide things (F22): all derived, never stored separately. */
export interface Flags {
  /** Start the tracker and upload only when the server has the tracking module. */
  tracking: boolean;
  /** Show stops and the estimated split; also the `segmenter` sent at shift start. */
  stops: boolean;
  segmenter: 'stops' | 'whole_shift';
  diagnostics: boolean;
  /** The server's sync module: without it the phone is upload-only (15 section 13). */
  sync: boolean;
  distanceUnit: 'km' | 'mi';
  /** IANA zone of the instance; local dates never use the device zone (15 section 10). */
  timezone: string;
}

export function deriveFlags(s: CachedSettings | null): Flags {
  // Unknown (never fetched): the safest reading is the plainest one.
  const tracking = s?.modules.tracking ?? true;
  const stops = !!s && s.modules.stops === true && s.stops_enabled && tracking;
  return {
    tracking,
    stops,
    segmenter: stops ? 'stops' : 'whole_shift',
    diagnostics: s?.modules.diagnostics === true,
    sync: s?.modules.sync ?? true,
    distanceUnit: s?.distance_unit ?? 'km',
    timezone: s?.timezone ?? 'UTC',
  };
}

export interface Credential {
  /** The address the phone connected through. A phone from before plan 28 has only this. */
  baseUrl: string;
  /** Plan 28: the server on the home network (http allowed) and the https one for away. */
  homeUrl?: string | null;
  awayUrl?: string | null;
  deviceId: number;
  deviceToken: string;
  instanceId: string | null;
}

export interface LinkStart {
  deviceCode: string;
  /** Six digits, shown on the phone and typed on the web. */
  userCode: string;
  expiresAt: number;
  /** How long to wait between polls (RFC 8628 `interval`). */
  intervalMs: number;
}

/** What `POST /pairing/redeem` (and a link, plan 28) answers. */
interface Redeemed {
  device_id: number;
  device_token: string;
  settings: CachedSettings;
  home_url?: unknown;
  away_url?: unknown;
}

export interface PairedState {
  credential: Credential;
  settings: CachedSettings | null;
}

const K_CRED = 'pairing.credential';
const K_SETTINGS = 'pairing.settings';
/** Set when a phone connects from the first-run screens: the setup steps (24 section 4.2) follow. */
const K_SETUP = 'pairing.setup';

/**
 * What the app start gate reads (24 section 4.1). `revoked`: the server refused this phone
 * (`device_revoked`); the credential is kept, but the phone must connect again.
 */
export type PairingStatus = 'paired' | 'unpaired' | 'revoked';

export interface PairingDeps {
  secure: KeyValueStore;
  plain: KeyValueStore;
  fetch: FetchFn;
  now?: () => number;
  deviceName?: string;
  appVersion?: string;
  /** Called with the settings whenever they are stored or loaded (feeds diagnostics level). */
  onSettings?: (s: CachedSettings) => void;
  /** Home or away for every request (plan 28); without it, `baseUrl` is used as before. */
  route?: RoutePicker;
  /** Plain http to any address (debug builds); otherwise only to home addresses. */
  anyHttp?: boolean;
  /** Checks every answer's instance and restore generation against what this phone was paired with. */
  monitor?: {
    observe(headers: Headers, expectedInstance: string | null): void;
  };
  /** Holds every halt of sending (revoked, wrong server, sign-in problem). Default: its own. */
  device?: DeviceSession;
}

export class Pairing {
  private readonly listeners = new Set<() => void>();
  /** The device session: the halt every sender obeys. Pairing again lifts it. */
  readonly device: DeviceSession;

  constructor(private readonly d: PairingDeps) {
    this.device = d.device ?? new DeviceSession(d.plain);
    // A revoke (or any halt) is a pairing change for the app start gate, again on each refusal:
    // the gate may have waited for a running shift to end.
    this.device.subscribe(() => this.changed());
  }

  /** Called after every pairing change (paired, unpaired, revoked). Returns the unsubscribe. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private changed() {
    for (const fn of [...this.listeners]) fn();
  }

  async status(): Promise<PairingStatus> {
    if (!(await this.d.secure.get(K_CRED))) return 'unpaired';
    return (await this.device.halted()) === 'repair' ? 'revoked' : 'paired';
  }

  /** True from a first connection until the driver finishes the setup steps. */
  async setupPending(): Promise<boolean> {
    return (await this.d.plain.get(K_SETUP)) === '1';
  }

  async finishSetup(): Promise<void> {
    await this.d.plain.remove(K_SETUP);
    this.changed();
  }

  /**
   * Where to redeem a code: its home address when the phone is on Wi-Fi and the home address
   * answers (plan 28: at home the phone never needs Tailscale), else the code's own address.
   */
  private async redeemAt(payload: PairingLink): Promise<string> {
    const home = payload.homeUrl;
    const route = this.d.route;
    if (!home || home === payload.baseUrl || !route) return payload.baseUrl;
    const picked = await route.pick({
      baseUrl: payload.baseUrl,
      homeUrl: home,
      awayUrl: payload.baseUrl,
      instanceId: null,
    });
    route.forget(); // a pick for a code is not one for the credential
    return picked.url;
  }

  /** Redeems the token; stores the credential securely and the settings in the cache. */
  async redeem(payload: PairingLink): Promise<PairedState> {
    const first = (await this.status()) !== 'paired';
    const used = await this.redeemAt(payload);
    let milewage = false; // every MileWage answer carries X-MileWage-Api (15 section 9.4)
    const client = new ApiClient({
      baseUrl: used,
      anyHttp: this.d.anyHttp,
      fetch: this.d.fetch,
      now: this.d.now,
      onResponse: (h) => void (milewage = h.has('X-MileWage-Api')),
    });
    const res = await client
      .request<Redeemed>('POST', '/pairing/redeem', {
        token: payload.token,
        device_name: this.d.deviceName ?? 'Android phone',
        platform: 'android',
        app_version: this.d.appVersion ?? '0.1.0',
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status > 0 && !milewage) {
          throw new ApiError(e.status, 'not_milewage', false);
        }
        throw e;
      });
    return this.keep(used, payload.homeUrl ?? null, res.data, res.status, res.headers, first);
  }

  /**
   * Stores what a redeem (or a link, plan 28) answered. Home: the address used when it is a home
   * address, else the code's `h`, else the server's `home_url`. Away: the address used when it is
   * not a home address, else the server's `away_url`. The server's values are checked: home must
   * be a home address and away https outside it, so an answer cannot lower the rules.
   */
  private async keep(
    used: string,
    codeHome: string | null,
    data: Redeemed,
    status: number,
    headers: Headers,
    first: boolean,
  ): Promise<PairedState> {
    const { device_id, device_token, settings } = data;
    if (typeof device_id !== 'number' || !/^mwd_/.test(String(device_token))) {
      throw new ApiError(status, 'bad_response', false);
    }
    const tidy = (v: unknown) =>
      typeof v === 'string' && ADDRESS.test(v) ? v.replace(/\/+$/, '') : null;
    const serverHome = tidy(data.home_url);
    const serverAway = tidy(data.away_url);
    const usedHome = isHomeAddress(used);
    const credential: Credential = {
      baseUrl: used,
      homeUrl: usedHome
        ? used
        : (codeHome ?? (serverHome && isHomeAddress(serverHome) ? serverHome : null)),
      awayUrl: !usedHome
        ? used
        : serverAway && /^https:/i.test(serverAway) && !isHomeAddress(serverAway)
          ? serverAway
          : null,
      deviceId: device_id,
      deviceToken: device_token,
      instanceId: headers.get('X-MileWage-Instance'),
    };
    await this.d.secure.set(K_CRED, JSON.stringify(credential));
    await this.d.plain.set(K_SETTINGS, JSON.stringify(settings));
    if (first) await this.d.plain.set(K_SETUP, '1');
    this.d.onSettings?.(settings);
    // A new credential: every halt is lifted at once, so every sender goes again (queued shift
    // creates and ends, points, the change feed), and a wrong-server block is cleared. The
    // session's resume is this pairing change for the listeners.
    await this.device.resume();
    return { credential, settings };
  }

  /**
   * Linking with a code (plan 28 section 4.4): asks the server found on the Wi-Fi; the phone shows
   * `userCode` and the driver types it on the web. `deviceCode` is the phone's secret for polling.
   */
  async startLink(baseUrl: string): Promise<LinkStart> {
    const client = new ApiClient({
      baseUrl,
      anyHttp: this.d.anyHttp,
      fetch: this.d.fetch,
      now: this.d.now,
    });
    const res = await client.request<{
      device_code?: unknown;
      user_code?: unknown;
      expires_in?: unknown;
      interval?: unknown;
    }>('POST', '/link-requests', {
      device_name: this.d.deviceName ?? 'Android phone',
      platform: 'android',
    });
    const d = res.data;
    if (
      typeof d.device_code !== 'string' ||
      typeof d.user_code !== 'string' ||
      !/^\d{6}$/.test(d.user_code)
    ) {
      throw new ApiError(res.status, 'bad_response', false);
    }
    const seconds = (v: unknown, fallback: number) =>
      typeof v === 'number' && v > 0 && v < 3600 ? v : fallback;
    return {
      deviceCode: d.device_code,
      userCode: d.user_code,
      expiresAt: (this.d.now ?? Date.now)() + seconds(d.expires_in, 600) * 1000,
      intervalMs: Math.max(1000, seconds(d.interval, 5) * 1000),
    };
  }

  /**
   * One poll: null while the driver has not typed the code; the new connection once they have.
   * Throws `link_expired` (expired, refused or used) and `slow_down` like any refusal.
   */
  async pollLink(baseUrl: string, deviceCode: string): Promise<PairedState | null> {
    const first = (await this.status()) !== 'paired';
    const client = new ApiClient({
      baseUrl,
      anyHttp: this.d.anyHttp,
      fetch: this.d.fetch,
      now: this.d.now,
    });
    const res = await client.request<Redeemed>('POST', '/link-requests/poll', {
      device_code: deviceCode,
    });
    if (res.status === 202) return null;
    return this.keep(baseUrl, null, res.data, res.status, res.headers, first);
  }

  /** Where requests go now (plan 28): home, away, or null before the first one. */
  get where(): 'home' | 'away' | null {
    return this.d.route?.where ?? null;
  }

  /** The server answered at a new home address on the Wi-Fi (same instance): keep it. */
  async updateHome(url: string): Promise<void> {
    const raw = await this.d.secure.get(K_CRED);
    if (!raw || !isHomeAddress(url)) return;
    const c = JSON.parse(raw) as Credential;
    await this.d.secure.set(K_CRED, JSON.stringify({ ...c, homeUrl: url }));
  }

  /** Settings that arrived through the change feed replace the cached copy (and drive the flags). */
  async storeSettings(settings: CachedSettings): Promise<void> {
    await this.d.plain.set(K_SETTINGS, JSON.stringify(settings));
    this.d.onSettings?.(settings);
  }

  async load(): Promise<PairedState | null> {
    const raw = await this.d.secure.get(K_CRED);
    if (!raw) return null;
    const cached = await this.d.plain.get(K_SETTINGS);
    return {
      credential: JSON.parse(raw) as Credential,
      settings: cached ? (JSON.parse(cached) as CachedSettings) : null,
    };
  }

  /**
   * `GET /settings` at app start and after each sync drain. On failure the cache stays and the
   * error is returned for the caller to show; a 401 means "re-pair" (08 section 4.3).
   */
  private clientFor(c: Credential): ApiClient {
    const route = this.d.route;
    return new ApiClient({
      baseUrl: route ? async () => (await route.pick(c)).url : c.baseUrl,
      anyHttp: this.d.anyHttp,
      onUnreachable: () => route?.forget(),
      token: c.deviceToken,
      fetch: this.d.fetch,
      now: this.d.now,
      blocked: this.device.blocked,
      onResponse: (h) => this.d.monitor?.observe(h, c.instanceId),
      // Revoked or refused: the device session stops every sender. Nothing is deleted.
      onProblem: (e) => {
        const reason = haltFor(e);
        if (reason) void this.device.halt(reason);
      },
    });
  }

  async refreshSettings(
    state: PairedState,
  ): Promise<{ state: PairedState; error: ApiError | null }> {
    const client = this.clientFor(state.credential);
    try {
      const res = await client.request<CachedSettings>('GET', '/settings');
      await this.d.plain.set(K_SETTINGS, JSON.stringify(res.data));
      this.d.onSettings?.(res.data);
      return { state: { ...state, settings: res.data }, error: null };
    } catch (e) {
      if (e instanceof ApiError) return { state, error: e };
      throw e;
    }
  }

  /** An authenticated client plus the flags from the cached settings; null when not paired. */
  async session(): Promise<{ client: ApiClient; flags: Flags } | null> {
    const state = await this.load();
    if (!state) return null;
    const client = this.clientFor(state.credential);
    return { client, flags: deriveFlags(state.settings) };
  }

  /** Forgets the credential. The telemetry buffer is not touched: it is kept for re-pairing. */
  async unpair(): Promise<void> {
    await this.d.secure.remove(K_CRED);
    await this.d.plain.remove(K_SETTINGS);
    await this.d.plain.remove(K_SETUP);
    await this.device.resume(); // nothing is halted for no pairing; tells the listeners
  }
}
