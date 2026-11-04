import {
  UNKNOWN_SNAPSHOT,
  type PermissionsPort,
  type PermSnapshot,
  type PermStatus,
  type RequestableStep,
} from './ladder';

const KEY = {
  foreground: 'foregroundLocation',
  background: 'backgroundLocation',
  activity: 'activityRecognition',
  notifications: 'notifications',
} as const;

/** Test double: `answers` is what the OS prompt returns for each step (default granted). */
export class FakePermissions implements PermissionsPort {
  snap: PermSnapshot;
  requests: RequestableStep[] = [];
  settingsOpened = 0;
  answers: Partial<Record<RequestableStep, PermStatus>> = {};

  constructor(snap: Partial<PermSnapshot> = {}) {
    this.snap = { ...UNKNOWN_SNAPSHOT, ...snap };
  }

  async snapshot(): Promise<PermSnapshot> {
    return { ...this.snap };
  }

  async request(step: RequestableStep): Promise<PermStatus> {
    this.requests.push(step);
    const answer = this.answers[step] ?? 'granted';
    this.snap = { ...this.snap, [KEY[step]]: answer };
    return answer;
  }

  async openAppSettings(): Promise<void> {
    this.settingsOpened++;
  }
}

/** Placeholder until the expo-location adapter is wired: asks nothing, grants nothing. */
export const notWiredPermissions: PermissionsPort = {
  snapshot: async () => ({ ...UNKNOWN_SNAPSHOT }),
  request: async () => 'undetermined',
  openAppSettings: async () => {},
};
