import { looksLikeCoordinate, validateEvent } from '@milewage/shared';
import type { EventRow } from './store';

export interface BundleShift {
  clientId: string;
  startedAt: number;
  endedAt: number | null;
  totalM: number | null;
  activeM: number | null;
  deadheadM: number | null;
  segmenter: string;
  calcVersion: number | null;
  reconStatus: string;
  /** Flag codes only; the `detail` of a flag can hold times and is left out. */
  flags: string[];
}

export interface BundleInput {
  events: readonly EventRow[];
  shifts: readonly BundleShift[];
  versions: Record<string, string | number>;
  modules: Record<string, boolean>;
  health: unknown;
  /** Already anonymized capture replay lines for the one session the owner ticked, if any. */
  capture?: unknown;
}

const stringLeaves = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => stringLeaves(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => stringLeaves(x, out));
  return out;
};

/**
 * The redacted debug bundle (16 section 10.2): relative times only, pseudonymous ids (D1, S1), flag codes without detail,
 * and every event re-validated against the shared schema; an event that fails, or whose text still looks like a coordinate
 * or a credential, is left out and counted. No dates, country, time zone, currency, names, addresses, odometer values,
 * labels or capture data (unless the owner ticked one session, passed in already anonymized).
 */
export function buildBundle(i: BundleInput) {
  const starts = [...i.events.map((e) => e.at), ...i.shifts.map((s) => s.startedAt)];
  const t0 = starts.length ? Math.min(...starts) : 0;
  const rel = (ms: number) => Math.round((ms - t0) / 1000);
  const devices = new Map<number, string>();
  const shiftNames = new Map(i.shifts.map((s, n) => [s.clientId, `S${n + 1}`]));
  let excluded = 0;
  const events: object[] = [];
  const device = {
    make: null as unknown,
    model: null as unknown,
    android: null as unknown,
    sdk: null as unknown,
  };
  for (const e of [...i.events].sort((a, b) => a.at - b.at || a.id - b.id)) {
    const checked = validateEvent({
      kind: e.kind,
      at: e.at,
      level: e.level,
      src: e.src,
      ...(e.seq !== null ? { seq: e.seq } : {}),
      ...(e.shift ? { shift: e.shift } : {}),
      v: e.v ?? '0',
      data: e.data,
    });
    const data = Object.fromEntries(Object.entries(e.data).filter(([k]) => k !== 'stop_key'));
    if (!checked.ok || stringLeaves(data).some(looksLikeCoordinate)) {
      excluded++;
      continue;
    }
    if (e.kind === 'app.start') {
      const d = (e.data as { device?: Record<string, unknown> }).device;
      if (d)
        Object.assign(device, { make: d.make, model: d.model, android: d.android, sdk: d.sdk });
    }
    if (e.deviceId !== null && !devices.has(e.deviceId))
      devices.set(e.deviceId, `D${devices.size + 1}`);
    events.push({
      t: rel(e.at),
      kind: e.kind,
      level: e.level,
      src: e.src,
      device: e.deviceId === null ? null : devices.get(e.deviceId),
      shift: e.shift ? (shiftNames.get(e.shift) ?? null) : null,
      v: e.v,
      data,
    });
  }
  // Device names are the driver's words: the health result keeps only the pseudonym.
  const health = i.health as
    { generated_at?: number; devices?: { device_id: number; name?: string }[] } | undefined;
  const pseudo = (id: number) => {
    if (!devices.has(id)) devices.set(id, `D${devices.size + 1}`);
    return devices.get(id);
  };
  const cleanHealth = health?.devices
    ? {
        // `generated_at` is an absolute time: the bundle carries relative times only.
        ...Object.fromEntries(Object.entries(health).filter(([k]) => k !== 'generated_at')),
        devices: health.devices.map((d) => ({
          ...Object.fromEntries(
            Object.entries(d).filter(([k]) => k !== 'name' && k !== 'device_id'),
          ),
          device: pseudo(d.device_id),
        })),
      }
    : health;
  return {
    format: 1,
    versions: i.versions,
    modules: i.modules,
    device,
    health: cleanHealth,
    shifts: i.shifts.map((s) => ({
      id: shiftNames.get(s.clientId),
      start_s: rel(s.startedAt),
      duration_s: s.endedAt === null ? null : Math.round((s.endedAt - s.startedAt) / 1000),
      total_m: s.totalM,
      active_m: s.activeM,
      deadhead_m: s.deadheadM,
      segmenter: s.segmenter,
      calc_version: s.calcVersion,
      recon: s.reconStatus,
      flags: s.flags,
    })),
    events,
    excluded_events: excluded,
    ...(i.capture === undefined ? {} : { capture: i.capture }),
  };
}
