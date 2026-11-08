/**
 * The permission ladder (09 section 5.3 and the Play disclosure rule, 02 onboarding).
 * Pure state machine: no Android calls. A `PermissionsPort` does the asking; `describeLadder`
 * turns what is granted into the next step and the warnings the driver must read.
 */
export type PermStatus = 'granted' | 'denied' | 'blocked' | 'undetermined';

/** What the OS reports right now. `blocked` means the OS will no longer show the prompt. */
export interface PermSnapshot {
  foregroundLocation: PermStatus;
  backgroundLocation: PermStatus;
  activityRecognition: PermStatus;
  notifications: PermStatus;
  locationServicesEnabled: boolean;
}

export type RequestableStep = 'foreground' | 'background' | 'activity' | 'notifications';
export type StepId = 'disclosure' | RequestableStep | 'battery';

export interface PermissionsPort {
  snapshot(): Promise<PermSnapshot>;
  /** Shows the OS prompt for one step and returns the resulting status. */
  request(step: RequestableStep): Promise<PermStatus>;
  /** Opens this app's page in system settings (where `blocked` permissions are changed). */
  openAppSettings(): Promise<void>;
}

export const UNKNOWN_SNAPSHOT: PermSnapshot = {
  foregroundLocation: 'undetermined',
  backgroundLocation: 'undetermined',
  activityRecognition: 'undetermined',
  notifications: 'undetermined',
  locationServicesEnabled: true,
};

/** Driver-visible state the OS cannot tell us. */
export interface LadderState {
  snapshot: PermSnapshot;
  /** The prominent location disclosure was accepted; Play requires it before the first prompt. */
  disclosureAccepted: boolean;
  /** The driver has been sent to the battery settings page once. */
  batteryVisited: boolean;
  /** Steps the driver chose "Not now" for during setup; they stay on the Home checklist. */
  skipped?: StepId[];
}

/** Plain-store key: the battery page was opened once (the OS cannot tell). */
export const BATTERY_VISITED = 'perm.batteryVisited';
/** Plain-store key: the location disclosure was accepted (the OS cannot tell). */
export const DISCLOSURE_ACCEPTED = 'perm.disclosureAccepted';

export const initialLadder = (
  snapshot: PermSnapshot = UNKNOWN_SNAPSHOT,
  batteryVisited = false,
): LadderState => ({ snapshot, disclosureAccepted: false, batteryVisited });

export type StepState = 'done' | 'current' | 'pending' | 'blocked';

export interface StepView {
  id: StepId;
  state: StepState;
  /** True when tracking cannot work without it. */
  required: boolean;
}

/** full: all the time. while_using: can stop when the screen is off. none: cannot track. */
export type TrackingMode = 'full' | 'while_using' | 'none';

export interface LadderView {
  steps: StepView[];
  next: StepId | null;
  mode: TrackingMode;
  warnings: string[];
}

const ORDER: { id: StepId; required: boolean }[] = [
  { id: 'disclosure', required: true },
  { id: 'foreground', required: true },
  { id: 'background', required: false },
  { id: 'activity', required: false },
  { id: 'notifications', required: false },
  { id: 'battery', required: false },
];

function isDone(state: LadderState, id: StepId): boolean {
  const s = state.snapshot;
  switch (id) {
    case 'disclosure':
      return state.disclosureAccepted;
    case 'foreground':
      return s.foregroundLocation === 'granted';
    case 'background':
      return s.backgroundLocation === 'granted';
    case 'activity':
      return s.activityRecognition === 'granted';
    case 'notifications':
      return s.notifications === 'granted';
    case 'battery':
      return state.batteryVisited;
  }
}

function isBlocked(s: PermSnapshot, id: StepId): boolean {
  switch (id) {
    case 'foreground':
      return s.foregroundLocation === 'blocked';
    case 'background':
      return s.backgroundLocation === 'blocked';
    case 'activity':
      return s.activityRecognition === 'blocked';
    case 'notifications':
      return s.notifications === 'blocked';
    default:
      return false;
  }
}

/** The disclosure comes first; Android offers background location only after foreground. */
function reachable(state: LadderState, id: StepId): boolean {
  if (id === 'disclosure') return true;
  if (id === 'foreground') return state.disclosureAccepted;
  if (id === 'background') return state.snapshot.foregroundLocation === 'granted';
  return true;
}

export function trackingMode(s: PermSnapshot): TrackingMode {
  if (s.foregroundLocation !== 'granted' || !s.locationServicesEnabled) return 'none';
  return s.backgroundLocation === 'granted' ? 'full' : 'while_using';
}

export function describeLadder(state: LadderState): LadderView {
  const steps: StepView[] = [];
  let next: StepId | null = null;
  for (const { id, required } of ORDER) {
    let view: StepState;
    if (isDone(state, id)) view = 'done';
    else if (isBlocked(state.snapshot, id)) view = 'blocked';
    else if (next === null && reachable(state, id) && !state.skipped?.includes(id)) {
      view = 'current';
    } else view = 'pending';
    // A blocked step does not hold the ladder: later steps stay reachable.
    if (view === 'current') next = id;
    steps.push({ id, state: view, required });
  }
  const s = state.snapshot;
  const mode = trackingMode(s);
  const warnings: string[] = [];
  if (!s.locationServicesEnabled) {
    warnings.push('Location is switched off on this phone. Turn it on or no miles are recorded.');
  }
  if (s.foregroundLocation === 'blocked' || s.foregroundLocation === 'denied') {
    warnings.push('Without location permission MileWage cannot record miles.');
  }
  if (mode === 'while_using') {
    warnings.push(
      'Location is set to "while using the app". Recording can stop when the screen is off or another app is in front. Choose "Allow all the time".',
    );
  }
  if (s.foregroundLocation === 'granted' && s.backgroundLocation === 'blocked') {
    warnings.push('"Allow all the time" can only be chosen in the app\'s system settings now.');
  }
  if (s.notifications === 'denied' || s.notifications === 'blocked') {
    warnings.push(
      'Without notifications you will not see the time and distance of your shift while you use other apps.',
    );
  }
  if (mode !== 'none' && !state.batteryVisited) {
    warnings.push('Set battery use to unrestricted so the phone does not stop the tracker.');
  }
  return { steps, next, mode, warnings };
}

/** A shift may start with while-using permission (with warnings) but not without location. */
export const canStartShift = (state: LadderState): boolean =>
  trackingMode(state.snapshot) !== 'none';

const FIELD = {
  foreground: 'foregroundLocation',
  background: 'backgroundLocation',
  activity: 'activityRecognition',
  notifications: 'notifications',
} as const;

/**
 * Performs the current step: accepts the disclosure, notes the battery visit, or shows the OS
 * prompt. The OS is re-read afterwards; the prompt's own answer fills in if the read still lags.
 */
export async function advance(port: PermissionsPort, state: LadderState): Promise<LadderState> {
  const { next } = describeLadder(state);
  if (next === null) return state;
  if (next === 'disclosure') return { ...state, disclosureAccepted: true };
  if (next === 'battery') return { ...state, batteryVisited: true };
  const answer = await port.request(next);
  const fresh = await port.snapshot();
  const field = FIELD[next];
  const merged = fresh[field] === 'undetermined' ? { ...fresh, [field]: answer } : fresh;
  return { ...state, snapshot: merged };
}

/** "Not now": the current step is left for later and the ladder moves on. */
export function skip(state: LadderState): LadderState {
  const { next } = describeLadder(state);
  return next ? { ...state, skipped: [...(state.skipped ?? []), next] } : state;
}

/**
 * The whole ladder as it stands now: the OS snapshot plus the facts only this app knows, read
 * from the plain store so a screen that mounts again starts from the truth, not from "missing".
 * The location prompt is only shown after the disclosure, so a location answer already on record
 * (granted, denied or blocked) means the disclosure was read, also on installs that never saved it.
 */
export async function loadLadder(
  port: PermissionsPort,
  plain: { get(key: string): Promise<string | null> },
): Promise<LadderState> {
  const [snapshot, battery, disclosure] = await Promise.all([
    port.snapshot(),
    plain.get(BATTERY_VISITED),
    plain.get(DISCLOSURE_ACCEPTED),
  ]);
  return {
    snapshot,
    disclosureAccepted: disclosure === '1' || snapshot.foregroundLocation !== 'undetermined',
    batteryVisited: battery === '1',
  };
}

/** Re-reads the OS after the driver comes back from system settings. */
export async function refresh(port: PermissionsPort, state: LadderState): Promise<LadderState> {
  return { ...state, snapshot: await port.snapshot() };
}
