import type { KeyValueStore } from '../pairing/pairing';
import {
  UNKNOWN_SNAPSHOT,
  type PermissionsPort,
  type PermSnapshot,
  type PermStatus,
  type RequestableStep,
} from './ladder';

export type RawResult = 'granted' | 'denied' | 'never_ask_again';

/** The Android calls the adapter needs. React Native's `PermissionsAndroid` fits this shape. */
export interface AndroidPermissionApi {
  /** API level of the running phone. */
  sdk: number;
  check(permission: string): Promise<boolean>;
  request(permission: string): Promise<RawResult>;
  /** True after the driver denied once and Android would still show the prompt again. */
  shouldShowRationale(permission: string): Promise<boolean>;
  openSettings(): Promise<void>;
}

/** Permission names. Only the ones already declared in app.config.js (09 section 5.3). */
export const P = {
  fine: 'android.permission.ACCESS_FINE_LOCATION',
  background: 'android.permission.ACCESS_BACKGROUND_LOCATION',
  activity: 'android.permission.ACTIVITY_RECOGNITION',
  notifications: 'android.permission.POST_NOTIFICATIONS',
} as const;

const NAME: Record<RequestableStep, string> = {
  foreground: P.fine,
  background: P.background,
  activity: P.activity,
  notifications: P.notifications,
};

/** First API level that has the permission; below it Android grants it implicitly. */
const SINCE: Record<RequestableStep, number> = {
  foreground: 1,
  background: 29,
  activity: 29,
  notifications: 33,
};

export interface AndroidPermissionsDeps {
  api: AndroidPermissionApi;
  /** Remembers which permissions were asked for, so "never asked" and "blocked" differ. */
  store: KeyValueStore;
  /** Whether the system location switch is on. Without a reader it is assumed on. */
  locationEnabled?: () => Promise<boolean>;
}

const askedKey = (step: RequestableStep) => `perm.asked.${step}`;

/**
 * `PermissionsPort` over Android's runtime permissions. Android cannot say "blocked" directly: a
 * permission that is not granted, was asked before, and no longer allows a rationale is blocked.
 * Needs no permission beyond the ones the manifest already declares (no CAMERA, no extras).
 */
export class AndroidPermissions implements PermissionsPort {
  constructor(private readonly d: AndroidPermissionsDeps) {}

  private async status(step: RequestableStep): Promise<PermStatus> {
    if (this.d.api.sdk < SINCE[step]) return 'granted';
    const name = NAME[step];
    if (await this.d.api.check(name)) return 'granted';
    if ((await this.d.store.get(askedKey(step))) !== '1') return 'undetermined';
    return (await this.d.api.shouldShowRationale(name)) ? 'denied' : 'blocked';
  }

  async snapshot(): Promise<PermSnapshot> {
    const [foregroundLocation, backgroundLocation, activityRecognition, notifications] =
      await Promise.all([
        this.status('foreground'),
        this.status('background'),
        this.status('activity'),
        this.status('notifications'),
      ]);
    let locationServicesEnabled = UNKNOWN_SNAPSHOT.locationServicesEnabled;
    try {
      locationServicesEnabled = (await this.d.locationEnabled?.()) ?? locationServicesEnabled;
    } catch {
      /* unreadable: keep the assumption */
    }
    return {
      foregroundLocation,
      backgroundLocation,
      activityRecognition,
      notifications,
      locationServicesEnabled,
    };
  }

  async request(step: RequestableStep): Promise<PermStatus> {
    if (this.d.api.sdk < SINCE[step]) return 'granted';
    const result = await this.d.api.request(NAME[step]);
    await this.d.store.set(askedKey(step), '1');
    if (result === 'granted') return 'granted';
    return result === 'never_ask_again' ? 'blocked' : 'denied';
  }

  openAppSettings(): Promise<void> {
    return this.d.api.openSettings();
  }
}

/** The live API. Loaded lazily so tests and other platforms never touch react-native here. */
export function createReactNativePermissionApi(): AndroidPermissionApi {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const rn = require('react-native') as typeof import('react-native');
  const pa = rn.PermissionsAndroid;
  type Name = Parameters<typeof pa.check>[0];
  type Rationale = (name: string) => Promise<boolean>;
  return {
    sdk: Number(rn.Platform.Version) || 0,
    check: (p) => pa.check(p as Name),
    request: async (p) => (await pa.request(p as Name)) as RawResult,
    shouldShowRationale: async (p) => {
      const fn = (pa as unknown as { shouldShowRequestPermissionRationale?: Rationale })
        .shouldShowRequestPermissionRationale;
      return fn ? fn.call(pa, p) : false;
    },
    openSettings: () => rn.Linking.openSettings(),
  };
}
