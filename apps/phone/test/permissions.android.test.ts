import {
  AndroidPermissions,
  P,
  type AndroidPermissionApi,
  type RawResult,
} from '../src/permissions/android';
import { advance, canStartShift, describeLadder, initialLadder } from '../src/permissions/ladder';
import { MemoryStore } from '../src/pairing/pairing';
import { nativeLocationSwitch } from '../src/tracker/native';

/** Stands in for the tracker module; each test sets what the phone answers. */
const mockNative: { locationEnabled?: () => boolean | null } = {};
jest.mock('../native/comma-tracker', () => ({ __esModule: true, default: mockNative }));

/** Models Android: a permission is granted, denied (can ask again) or blocked. */
class FakeAndroid implements AndroidPermissionApi {
  granted = new Set<string>();
  denials = new Map<string, number>();
  /** What the next prompt for a permission answers; default grants. */
  answers = new Map<string, RawResult>();
  asked: string[] = [];
  settingsOpened = 0;
  constructor(public sdk = 34) {}
  async check(p: string) {
    return this.granted.has(p);
  }
  async request(p: string): Promise<RawResult> {
    this.asked.push(p);
    const a = this.answers.get(p) ?? 'granted';
    if (a === 'granted') this.granted.add(p);
    else if (a === 'never_ask_again') this.denials.set(p, 99);
    else this.denials.set(p, (this.denials.get(p) ?? 0) + 1);
    // Android blocks after a second denial (or when the answer says so).
    return a === 'denied' && (this.denials.get(p) ?? 0) >= 2 ? 'never_ask_again' : a;
  }
  async shouldShowRationale(p: string) {
    return (this.denials.get(p) ?? 0) === 1;
  }
  async openSettings() {
    this.settingsOpened++;
  }
}

function make(api = new FakeAndroid(), locationEnabled?: () => Promise<boolean | null>) {
  const store = new MemoryStore();
  return { api, store, port: new AndroidPermissions({ api, store, locationEnabled }) };
}

describe('AndroidPermissions', () => {
  it('reports undetermined before anything was asked', async () => {
    const snap = await make().port.snapshot();
    expect(snap).toMatchObject({
      foregroundLocation: 'undetermined',
      backgroundLocation: 'undetermined',
      notifications: 'undetermined',
      locationServicesEnabled: true,
    });
  });

  it('walks the whole ladder to full tracking with the right permission names', async () => {
    const m = make();
    let state = initialLadder(await m.port.snapshot());
    for (let i = 0; i < 10 && describeLadder(state).next; i++) state = await advance(m.port, state);
    expect(m.api.asked).toEqual([P.fine, P.background, P.activity, P.notifications]);
    expect(describeLadder(state).mode).toBe('full');
  });

  it('asks only for permissions the manifest allows, never the camera', async () => {
    const m = make();
    for (const step of ['foreground', 'background', 'activity', 'notifications'] as const)
      await m.port.request(step);
    const allowed = /FINE_LOCATION|BACKGROUND_LOCATION|ACTIVITY_RECOGNITION|POST_NOTIFICATIONS/;
    expect(m.api.asked.every((p) => allowed.test(p))).toBe(true);
    expect(m.api.asked.join()).not.toMatch(/CAMERA/);
  });

  it('denied once is denied (can ask again); denied for good is blocked', async () => {
    const m = make();
    m.api.answers.set(P.fine, 'denied');
    expect(await m.port.request('foreground')).toBe('denied');
    expect((await m.port.snapshot()).foregroundLocation).toBe('denied');
    expect(await m.port.request('foreground')).toBe('blocked');
    expect((await m.port.snapshot()).foregroundLocation).toBe('blocked');
  });

  it('never_ask_again on the first prompt is blocked right away', async () => {
    const m = make();
    m.api.answers.set(P.background, 'never_ask_again');
    expect(await m.port.request('background')).toBe('blocked');
    expect((await m.port.snapshot()).backgroundLocation).toBe('blocked');
  });

  it('the answer survives an app restart (a new adapter over the same store)', async () => {
    const m = make();
    m.api.answers.set(P.notifications, 'never_ask_again');
    await m.port.request('notifications');
    const again = new AndroidPermissions({ api: m.api, store: m.store });
    expect((await again.snapshot()).notifications).toBe('blocked');
  });

  it('a permission granted later in system settings reads as granted', async () => {
    const m = make();
    m.api.answers.set(P.fine, 'never_ask_again');
    await m.port.request('foreground');
    m.api.granted.add(P.fine);
    expect((await m.port.snapshot()).foregroundLocation).toBe('granted');
  });

  it('older Android versions grant the newer permissions implicitly', async () => {
    const m = make(new FakeAndroid(28));
    const snap = await m.port.snapshot();
    expect(snap.backgroundLocation).toBe('granted');
    expect(snap.activityRecognition).toBe('granted');
    expect(snap.notifications).toBe('granted');
    expect(snap.foregroundLocation).toBe('undetermined');
    expect(await m.port.request('notifications')).toBe('granted');
    expect(m.api.asked).toEqual([]);
    // Android 12 has no POST_NOTIFICATIONS prompt either
    expect((await make(new FakeAndroid(32)).port.snapshot()).notifications).toBe('granted');
  });

  it('reads the location switch and survives a reader that throws', async () => {
    const off = make(undefined, async () => false);
    expect((await off.port.snapshot()).locationServicesEnabled).toBe(false);
    const bad = make(undefined, async () => {
      throw new Error('x');
    });
    expect((await bad.port.snapshot()).locationServicesEnabled).toBe(true);
  });

  it('with the Location switch off the ladder warns and a shift cannot start; on, neither', async () => {
    const OFF = 'Location is switched off on this phone. Turn it on or no miles are recorded.';
    const ladder = async (on: boolean | null) => {
      const m = make(undefined, async () => on);
      for (const p of Object.values(P)) m.api.granted.add(p);
      return { ...initialLadder(await m.port.snapshot(), true), disclosureAccepted: true };
    };
    const off = await ladder(false);
    expect(describeLadder(off).warnings).toContain(OFF);
    expect(describeLadder(off).mode).toBe('none');
    expect(canStartShift(off)).toBe(false);
    for (const on of [true, null]) {
      const state = await ladder(on);
      expect(describeLadder(state).warnings).toEqual([]);
      expect(canStartShift(state)).toBe(true);
    }
  });

  it('reads the switch from the tracker module, and null on a build without the reader', async () => {
    mockNative.locationEnabled = () => false;
    expect(await nativeLocationSwitch()).toBe(false);
    mockNative.locationEnabled = () => true;
    expect(await nativeLocationSwitch()).toBe(true);
    delete mockNative.locationEnabled;
    expect(await nativeLocationSwitch()).toBeNull();
    const port = make(undefined, nativeLocationSwitch).port;
    expect((await port.snapshot()).locationServicesEnabled).toBe(true);
  });

  it('opens the app settings page', async () => {
    const m = make();
    await m.port.openAppSettings();
    expect(m.api.settingsOpened).toBe(1);
  });
});
