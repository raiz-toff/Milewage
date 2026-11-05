import { ApiClient, ApiError, type FetchFn } from '../api/client';

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

export interface PairingPayload {
  baseUrl: string;
  token: string;
}

/**
 * `milewage://pair?v=1&u=<url-encoded base URL>&t=<mwp_ token>` (08 section 2.4).
 * Returns null for anything else, including another version, so a scan of a stray QR does nothing.
 */
export function parsePairingPayload(text: string): PairingPayload | null {
  const m = /^milewage:\/\/pair\?(.*)$/.exec(text.trim());
  if (!m) return null;
  const params = new Map<string, string>();
  for (const pair of m[1]!.split('&')) {
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
  if (params.get('v') !== '1' || !u || !t || !/^mwp_[A-Za-z0-9_-]{10,}$/.test(t)) return null;
  if (!/^https?:\/\/[^\s/?#]+(:\d+)?(\/[^\s?#]*)?$/.test(u)) return null;
  return { baseUrl: u.replace(/\/+$/, ''), token: t };
}

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
  baseUrl: string;
  deviceId: number;
  deviceToken: string;
  instanceId: string | null;
}

export interface PairedState {
  credential: Credential;
  settings: CachedSettings | null;
}

const K_CRED = 'pairing.credential';
const K_SETTINGS = 'pairing.settings';

export interface PairingDeps {
  secure: KeyValueStore;
  plain: KeyValueStore;
  fetch: FetchFn;
  now?: () => number;
  deviceName?: string;
  appVersion?: string;
  /** Called with the settings whenever they are stored or loaded (feeds diagnostics level). */
  onSettings?: (s: CachedSettings) => void;
}

export class Pairing {
  constructor(private readonly d: PairingDeps) {}

  /** Redeems the token; stores the credential securely and the settings in the cache. */
  async redeem(payload: PairingPayload): Promise<PairedState> {
    const client = new ApiClient({
      baseUrl: payload.baseUrl,
      fetch: this.d.fetch,
      now: this.d.now,
    });
    const res = await client.request<{
      device_id: number;
      device_token: string;
      settings: CachedSettings;
    }>('POST', '/pairing/redeem', {
      token: payload.token,
      device_name: this.d.deviceName ?? 'Android phone',
      platform: 'android',
      app_version: this.d.appVersion ?? '0.1.0',
    });
    const { device_id, device_token, settings } = res.data;
    if (typeof device_id !== 'number' || !/^mwd_/.test(String(device_token))) {
      throw new ApiError(res.status, 'bad_response', false);
    }
    const credential: Credential = {
      baseUrl: payload.baseUrl,
      deviceId: device_id,
      deviceToken: device_token,
      instanceId: res.headers.get('X-MileWage-Instance'),
    };
    await this.d.secure.set(K_CRED, JSON.stringify(credential));
    await this.d.plain.set(K_SETTINGS, JSON.stringify(settings));
    this.d.onSettings?.(settings);
    return { credential, settings };
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
  async refreshSettings(
    state: PairedState,
  ): Promise<{ state: PairedState; error: ApiError | null }> {
    const client = new ApiClient({
      baseUrl: state.credential.baseUrl,
      token: state.credential.deviceToken,
      fetch: this.d.fetch,
      now: this.d.now,
    });
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
    const client = new ApiClient({
      baseUrl: state.credential.baseUrl,
      token: state.credential.deviceToken,
      fetch: this.d.fetch,
      now: this.d.now,
    });
    return { client, flags: deriveFlags(state.settings) };
  }

  /** Forgets the credential. The telemetry buffer is not touched: it is kept for re-pairing. */
  async unpair(): Promise<void> {
    await this.d.secure.remove(K_CRED);
    await this.d.plain.remove(K_SETTINGS);
  }
}
