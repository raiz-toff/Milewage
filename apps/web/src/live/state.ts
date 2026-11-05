import type { Schemas } from '../api/client';
import type { RoutePoint } from '../map/route';

type Shift = Schemas['Shift'];

type Frame<T extends keyof Schemas, K extends string> = Omit<Schemas[T], 'type'> & { type: K };

/**
 * Frames the server sends on /live (08 section 6). The generated `type` of these schemas is the
 * schema's name (the generator does not read `const`), so the tag is restated here. `hello`
 * also carries `device_online` (device id -> online), which the OpenAPI schema does not list.
 */
export type LiveFrame =
  | (Frame<'WsHello', 'hello'> & { device_online?: Record<string, boolean> })
  | Frame<'WsPosition', 'position'>
  | Frame<'WsShift', 'shift'>
  | Frame<'WsStops', 'stops'>
  | Frame<'WsDevice', 'device'>
  | Frame<'WsPing', 'ping'>;

export interface LiveState {
  /** The shift being followed: the active one, or the one that just ended. */
  shift: Shift | null;
  trail: RoutePoint[];
  stopCount: number | null;
  /** device id -> online. Empty until the server says. */
  devices: Record<string, boolean>;
  helloAt: number | null;
}

export const initialLive: LiveState = {
  shift: null,
  trail: [],
  stopCount: null,
  devices: {},
  helloAt: null,
};

/** The trail is capped: a long shift at the 2 s throttle would otherwise grow without bound. */
export const TRAIL_LIMIT = 5000;

/** Adds points in time order, dropping duplicates and the oldest beyond the cap. */
export function mergeTrail(trail: RoutePoint[], more: RoutePoint[]): RoutePoint[] {
  const seen = new Set(trail.map((p) => p.t));
  const merged = [...trail];
  for (const p of more) {
    if (!seen.has(p.t)) {
      seen.add(p.t);
      merged.push(p);
    }
  }
  merged.sort((a, b) => a.t - b.t);
  return merged.length > TRAIL_LIMIT ? merged.slice(merged.length - TRAIL_LIMIT) : merged;
}

/** One frame applied to the state. Frames that do not concern the followed shift are ignored. */
export function applyFrame(state: LiveState, frame: LiveFrame): LiveState {
  switch (frame.type) {
    case 'hello':
      return {
        ...state,
        shift: frame.active_shift,
        trail: frame.active_shift && state.shift?.id === frame.active_shift.id ? state.trail : [],
        stopCount: null,
        devices: Object.fromEntries(
          Object.entries(frame.device_online ?? state.devices).map(([k, v]) => [k, Boolean(v)]),
        ),
        helloAt: frame.server_time,
      };
    case 'position': {
      // A position for a shift we are not following starts following it.
      const same = state.shift?.id === frame.shift_id;
      const point: RoutePoint = {
        t: frame.recorded_at,
        lat: frame.lat_e7 / 1e7,
        lon: frame.lon_e7 / 1e7,
        speed: typeof frame.speed_dmps === 'number' ? frame.speed_dmps / 10 : null,
      };
      if (state.shift && !same) return state;
      return { ...state, trail: mergeTrail(state.trail, [point]) };
    }
    case 'shift':
      return frame.event === 'started'
        ? { ...state, shift: frame.shift, trail: [], stopCount: null }
        : {
            ...state,
            shift: state.shift && state.shift.id !== frame.shift.id ? state.shift : frame.shift,
          };
    case 'stops':
      return state.shift?.id === frame.shift_id
        ? { ...state, stopCount: frame.stops.length }
        : state;
    case 'device':
      return {
        ...state,
        devices: { ...state.devices, [frame.device_id]: frame.state === 'online' },
      };
    case 'ping':
      return state;
  }
}

/** Seconds to wait before reconnect attempt `n` (0-based): 1, 2, 4 ... capped at 30. */
export const backoffSeconds = (n: number) => Math.min(30, 2 ** n);
