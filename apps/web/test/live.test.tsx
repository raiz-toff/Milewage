// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveUrl } from '../src/live/connection';
import {
  TRAIL_LIMIT,
  applyFrame,
  backoffSeconds,
  initialLive,
  mergeTrail,
} from '../src/live/state';
import type { LiveFrame } from '../src/live/state';
import type { Modules } from '../src/api/client';
import { shift } from './support/fixtures';
import { renderApp, settingsFixture, signedIn } from './support/kit';

// WebGL is not available in jsdom: the map library is replaced by a recorder.
const ml = vi.hoisted(() => {
  const state = {
    maps: [] as FakeMap[],
    markers: [] as { lngLat: number[] | null }[],
  };
  class FakeMap {
    handlers: Record<string, () => void> = {};
    sources: Record<string, { data: unknown; setData: (d: unknown) => void }> = {};
    eased: number[][] = [];
    removed = false;
    constructor() {
      state.maps.push(this);
    }
    on(n: string, cb: () => void) {
      this.handlers[n] = cb;
    }
    once(n: string, cb: () => void) {
      this.handlers[n] = cb;
    }
    getSource(id: string) {
      return this.sources[id];
    }
    addSource(id: string, s: { data: unknown }) {
      const src = { data: s.data, setData: (d: unknown) => (src.data = d) };
      this.sources[id] = src;
    }
    addLayer() {}
    jumpTo() {}
    easeTo(o: { center: number[] }) {
      this.eased.push(o.center);
    }
    isStyleLoaded() {
      return true;
    }
    remove() {
      this.removed = true;
    }
  }
  class Marker {
    s = { lngLat: null as number[] | null };
    constructor() {
      state.markers.push(this.s);
    }
    setLngLat(l: number[]) {
      this.s.lngLat = l;
      return this;
    }
    addTo() {
      return this;
    }
  }
  return { state, Map: FakeMap, Marker };
});
vi.mock('maplibre-gl', () => ({ default: ml, Map: ml.Map, Marker: ml.Marker }));

class FakeSocket {
  static all: FakeSocket[] = [];
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.closed = true;
    this.onclose?.();
  }
  // Test helpers
  open() {
    act(() => this.onopen?.());
  }
  say(frame: unknown) {
    act(() =>
      this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) }),
    );
  }
  drop() {
    act(() => this.onclose?.());
  }
}

beforeEach(() => {
  FakeSocket.all.length = 0;
  ml.state.maps.length = 0;
  ml.state.markers.length = 0;
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const active = (over: object = {}) => shift({ status: 'active', ended_at: null, ...over });
const hello = (s: object | null = active(), extra: object = {}) => ({
  type: 'hello',
  server_time: 1_700_000_600_000,
  active_shift: s,
  ...extra,
});
const pos = (n: number, over: object = {}) => ({
  type: 'position',
  shift_id: 1,
  seq: n,
  recorded_at: 1_700_000_000_000 + n * 2000,
  lat_e7: 450_000_000 + n * 1000,
  lon_e7: -750_000_000,
  speed_dmps: 100,
  accuracy_m: 5,
  ...over,
});
const point = (t: number) => ({ t, lat: 45, lon: -75, speed: null });

function open(modules: Partial<Modules> = {}, extra = {}) {
  return renderApp(
    {
      ...signedIn(settingsFixture({ modules })),
      'GET /shifts/1/route': () => ({
        body: {
          source: 'raw',
          t: [1_699_999_990_000, 1_699_999_995_000],
          lat_e7: [449_990_000, 449_995_000],
          lon_e7: [-750_000_000, -750_000_000],
        },
      }),
      ...extra,
    },
    '/live',
  );
}
const socket = async () => {
  await waitFor(() => expect(FakeSocket.all.length).toBeGreaterThan(0));
  return FakeSocket.all[FakeSocket.all.length - 1]!;
};
const sourceData = (): { geometry: { coordinates: number[][] } } =>
  ml.state.maps[0]!.sources.trail!.data as never;
const mapReady = async () => {
  await waitFor(() => expect(ml.state.maps.length).toBe(1));
  act(() => ml.state.maps[0]!.handlers.load!());
};

describe('live map', () => {
  it('connects to the live socket on its own origin and answers ping with pong', async () => {
    open();
    const ws = await socket();
    expect(ws.url).toMatch(/^ws:\/\/.+\/api\/v1\/live$/);
    expect(screen.getByLabelText('Connection').textContent).toBe('Connecting');
    ws.open();
    expect(screen.getByLabelText('Connection').textContent).toBe('Live');
    ws.say({ type: 'ping', server_time: 1 });
    expect(JSON.parse(ws.sent[0]!)).toEqual({ type: 'pong' });
  });

  it('shows the running shift and moves the marker and line with each position', async () => {
    open();
    const ws = await socket();
    ws.open();
    await mapReady();
    ws.say(hello());
    expect(await screen.findByText('Phone')).toBeTruthy();
    ws.say(pos(1));
    ws.say(pos(2));
    await waitFor(() => expect(sourceData().geometry.coordinates.length).toBeGreaterThanOrEqual(2));
    const coords = sourceData().geometry.coordinates;
    expect(coords[coords.length - 1]).toEqual([-75, 45.0002]);
    expect(ml.state.markers[0]!.lngLat).toEqual([-75, 45.0002]);
    expect(ml.state.maps[0]!.eased.length).toBeGreaterThan(0);
    expect(screen.getByText(/36 km\/h/)).toBeTruthy();
    // one map for the whole visit: new points never recreate it
    expect(ml.state.maps.length).toBe(1);
  });

  it('does not recentre when Follow is switched off', async () => {
    open();
    const ws = await socket();
    ws.open();
    await mapReady();
    ws.say(hello());
    ws.say(pos(1));
    await waitFor(() => expect(ml.state.maps[0]!.eased.length).toBeGreaterThan(0));
    fireEvent.click(screen.getByLabelText('Follow the newest position'));
    const before = ml.state.maps[0]!.eased.length;
    ws.say(pos(2));
    await waitFor(() => expect(sourceData().geometry.coordinates.length).toBeGreaterThan(1));
    expect(ml.state.maps[0]!.eased.length).toBe(before);
  });

  it('fills in the part of a running shift that came before the socket opened', async () => {
    const { calls } = open();
    const ws = await socket();
    ws.open();
    await mapReady();
    ws.say(hello());
    await waitFor(() => expect(calls.some((c) => c.path === '/shifts/1/route')).toBe(true));
    await waitFor(() => expect(sourceData().geometry.coordinates.length).toBe(2));
  });

  it('replay off: no route request for the backfill', async () => {
    const { calls } = open({ replay: false });
    const ws = await socket();
    ws.open();
    ws.say(hello());
    await screen.findByText('Phone');
    expect(calls.some((c) => c.path.endsWith('/route'))).toBe(false);
  });

  it('says so when no shift is running, and when the shift ends', async () => {
    open();
    const ws = await socket();
    ws.open();
    ws.say(hello(null));
    expect(await screen.findByText(/No shift is running/)).toBeTruthy();
    ws.say({ type: 'shift', event: 'started', shift: active() });
    expect(await screen.findByText('Started')).toBeTruthy();
    ws.say({ type: 'shift', event: 'ended', shift: shift() });
    expect(await screen.findByText(/The shift has ended/)).toBeTruthy();
    expect(screen.queryByText('Started')).toBeNull();
  });

  it('shows the phone going offline and online', async () => {
    open();
    const ws = await socket();
    ws.open();
    ws.say(hello(active(), { device_online: { '3': true } }));
    expect(await screen.findByText('online')).toBeTruthy();
    ws.say({ type: 'device', device_id: 3, state: 'offline', last_seen_at: 1 });
    expect(await screen.findByText('offline')).toBeTruthy();
  });

  it('shows the stop count only while stops are on', async () => {
    open();
    const ws = await socket();
    ws.open();
    ws.say(hello());
    ws.say({ type: 'stops', shift_id: 1, stops: [{}, {}] });
    expect(await screen.findByText(/2 stops detected so far \(estimated\)/)).toBeTruthy();
    cleanup();
    FakeSocket.all.length = 0;
    open({ stops: false });
    const ws2 = await socket();
    ws2.open();
    ws2.say(hello());
    ws2.say({ type: 'stops', shift_id: 1, stops: [{}, {}] });
    await screen.findByText('Phone');
    expect(screen.queryByText(/stops detected/)).toBeNull();
  });

  it('skips a frame that is not JSON or has no type', async () => {
    open();
    const ws = await socket();
    ws.open();
    ws.say('not json');
    ws.say({ nothing: true });
    ws.say(hello());
    expect(await screen.findByText('Phone')).toBeTruthy();
  });

  it('reconnects with 1 s then 2 s waits, and starts over from the new hello', async () => {
    open();
    const first = await socket();
    first.open();
    first.say(hello());
    await screen.findByText('Phone');
    // Testing Library's async helpers wait on setTimeout, so fake it only from here on.
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    first.drop();
    expect(screen.getByLabelText('Connection').textContent).toContain('Reconnecting');
    expect(FakeSocket.all.length).toBe(1);
    act(() => vi.advanceTimersByTime(999));
    expect(FakeSocket.all.length).toBe(1);
    act(() => vi.advanceTimersByTime(1));
    expect(FakeSocket.all.length).toBe(2);
    // The second socket fails before it opens: wait 2 s.
    FakeSocket.all[1]!.drop();
    act(() => vi.advanceTimersByTime(1999));
    expect(FakeSocket.all.length).toBe(2);
    act(() => vi.advanceTimersByTime(1));
    expect(FakeSocket.all.length).toBe(3);
    const third = FakeSocket.all[2]!;
    third.open();
    expect(screen.getByLabelText('Connection').textContent).toBe('Live');
    third.say(hello(null));
    expect(screen.getByText(/No shift is running/)).toBeTruthy();
    // a successful open resets the wait to 1 s
    third.drop();
    act(() => vi.advanceTimersByTime(1000));
    expect(FakeSocket.all.length).toBe(4);
  });

  it('closes the socket and stops reconnecting when the screen is left', async () => {
    const view = open();
    const ws = await socket();
    ws.open();
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    view.unmount();
    expect(ws.closed).toBe(true);
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeSocket.all.length).toBe(1);
  });
});

describe('live module off', () => {
  it('no screen in the navigation, no socket, and the URL leads to the first visible screen', async () => {
    open({ live: false });
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByRole('link', { name: 'Live map' })).toBeNull();
    expect(FakeSocket.all.length).toBe(0);
  });
});

describe('live state', () => {
  const withShift = applyFrame(initialLive, hello() as LiveFrame);

  it('a position for another shift is ignored, one with no shift known is kept', () => {
    expect(applyFrame(withShift, pos(1, { shift_id: 9 }) as LiveFrame).trail).toEqual([]);
    expect(applyFrame(initialLive, pos(1) as LiveFrame).trail.length).toBe(1);
  });

  it('hello for the same shift keeps the trail, for another one clears it', () => {
    const withTrail = applyFrame(withShift, pos(1) as LiveFrame);
    expect(applyFrame(withTrail, hello() as LiveFrame).trail.length).toBe(1);
    expect(applyFrame(withTrail, hello(active({ id: 2 })) as LiveFrame).trail).toEqual([]);
    expect(applyFrame(withTrail, hello(null) as LiveFrame).trail).toEqual([]);
  });

  it('a started shift clears the trail; an update for another shift is ignored', () => {
    const withTrail = applyFrame(withShift, pos(1) as LiveFrame);
    const started = applyFrame(withTrail, {
      type: 'shift',
      event: 'started',
      shift: active({ id: 2 }),
    } as LiveFrame);
    expect(started.trail).toEqual([]);
    expect(started.shift!.id).toBe(2);
    const other = applyFrame(started, {
      type: 'shift',
      event: 'updated',
      shift: active({ id: 1 }),
    } as LiveFrame);
    expect(other.shift!.id).toBe(2);
  });

  it('merges a trail in time order without duplicates and caps it', () => {
    expect(mergeTrail([point(3), point(1)], [point(2), point(3)]).map((p) => p.t)).toEqual([
      1, 2, 3,
    ]);
    const many = Array.from({ length: TRAIL_LIMIT + 10 }, (_, i) => point(i));
    const capped = mergeTrail([], many);
    expect(capped.length).toBe(TRAIL_LIMIT);
    expect(capped[0]!.t).toBe(10);
  });

  it('backoff doubles to a 30 s cap; the URL swaps the scheme', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map(backoffSeconds)).toEqual([1, 2, 4, 8, 16, 30, 30, 30]);
    expect(liveUrl('http://x:3000')).toBe('ws://x:3000/api/v1/live');
    expect(liveUrl('https://x')).toBe('wss://x/api/v1/live');
  });
});
