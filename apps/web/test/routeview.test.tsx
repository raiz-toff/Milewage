// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stop, trip } from './support/fixtures';
import { renderApp, settingsFixture, signedIn } from './support/kit';

// MapLibre needs WebGL, which jsdom does not have; the library is replaced by a recorder.
const ml = vi.hoisted(() => {
  const state = {
    maps: [] as {
      options: { style: unknown };
      handlers: Record<string, () => void>;
      setStyle: ReturnType<typeof vi.fn>;
      sources: Record<string, { data: unknown }>;
      paint: Record<string, unknown>;
      fits: unknown[];
      eases: unknown[];
    }[],
    failConstructor: false,
    markers: [] as {
      lngLat: number[] | null;
      on: boolean;
      element?: HTMLElement;
      color?: string;
    }[],
  };
  class Map {
    handlers: Record<string, () => void> = {};
    sources: Record<string, { data: unknown }> = {};
    paint: Record<string, unknown> = {};
    fits: unknown[] = [];
    eases: unknown[] = [];
    setStyle = vi.fn();
    constructor(public options: { style: unknown }) {
      if (state.failConstructor) throw new Error('WebGL is not available');
      state.maps.push(this);
    }
    on(name: string, cb: () => void) {
      this.handlers[name] = cb;
    }
    once(name: string, cb: () => void) {
      this.handlers[name] = cb;
    }
    getSource(id: string) {
      const src = this.sources[id];
      return src && { ...src, setData: (d: unknown) => (src.data = d) };
    }
    addSource(id: string, src: { data: unknown }) {
      this.sources[id] = src;
    }
    addLayer() {}
    setPaintProperty(layer: string, name: string, value: unknown) {
      this.paint[`${layer}.${name}`] = value;
    }
    fitBounds(b: unknown) {
      this.fits.push(b);
    }
    easeTo(o: unknown) {
      this.eases.push(o);
    }
    getZoom() {
      return 12;
    }
    isStyleLoaded() {
      return false;
    }
    remove() {}
  }
  class Marker {
    state;
    constructor(o: { element?: HTMLElement; color?: string } = {}) {
      this.state = { lngLat: null as number[] | null, on: false, ...o };
      state.markers.push(this.state);
    }
    setLngLat(l: number[]) {
      this.state.lngLat = l;
      return this;
    }
    addTo() {
      this.state.on = true;
      return this;
    }
    remove() {
      this.state.on = false;
    }
  }
  return { state, Map, Marker };
});
vi.mock('maplibre-gl', () => ({ default: ml, Map: ml.Map, Marker: ml.Marker }));

afterEach(cleanup);
beforeEach(() => {
  ml.state.maps.length = 0;
  ml.state.markers.length = 0;
  ml.state.failConstructor = false;
});

const shift = {
  id: 1,
  client_id: '00000000-0000-4000-8000-000000000001',
  vehicle_id: 1,
  status: 'ended',
  segmenter: 'whole_shift',
  started_at: 1_700_000_000_000,
  ended_at: 1_700_003_600_000,
  local_date: '2023-11-14',
  total_m: 5000,
  active_m: 5000,
  deadhead_m: 0,
  personal_m: 0,
  calc_version: 3,
  calculated_at: 1,
  notes: null,
  deduction_cents: null,
  flags: [],
};
const route = {
  source: 'raw',
  t: [1_700_000_000_000, 1_700_001_800_000, 1_700_003_600_000],
  lat_e7: [450_000_000, 450_100_000, 450_200_000],
  lon_e7: [-750_000_000, -750_000_000, -750_100_000],
  speed_dmps: [0, 100, 0],
};

const T0 = 1_700_000_000_000;
const trips = [
  trip(1, { started_at: T0, ended_at: T0 + 1_700_000 }),
  trip(2, { started_at: T0 + 1_900_000, ended_at: T0 + 3_600_000 }),
];
const stops = [
  stop(2, { started_at: T0 + 2_000_000, lat_e7: 450_200_000, confidence: 'low' }),
  stop(1, { started_at: T0 + 1_700_000, lat_e7: 450_100_000 }),
];

function open(settings = settingsFixture(), routeAnswer: object = { body: route }) {
  return renderApp(
    {
      ...signedIn(settings),
      'GET /shifts/1': () => ({ body: shift }),
      'GET /shifts/1/route': () => routeAnswer,
      'GET /shifts/1/trips': () => ({ body: trips }),
      'GET /shifts/1/stops': () => ({ body: stops }),
    },
    '/shifts/1',
  );
}

describe('route view', () => {
  it('draws on the OpenFreeMap basemap when no style URL is configured, and scrubs', async () => {
    open();
    // The first test pays for the lazy import of the map module; a loaded machine needs longer.
    await waitFor(() => expect(ml.state.maps).toHaveLength(1), { timeout: 5000 });
    expect(ml.state.maps[0]!.options.style).toMatch(/tiles\.openfreemap\.org/);
    // The Elastic Slider: role="slider", moved with the keyboard (Shift+arrow = 10 steps).
    const slider = screen.getByRole('slider', { name: 'Replay position' });
    expect(slider.getAttribute('aria-valuetext')).toMatch(/0 km\/h/);
    const pin = () => ml.state.markers.find((m) => m.color);
    await waitFor(() => expect(pin()).toBeTruthy());
    expect(pin()!.on).toBe(false); // at the start the Start marker is enough
    for (let i = 0; i < 50; i++) fireEvent.keyDown(slider, { key: 'ArrowRight', shiftKey: true });
    expect(slider.getAttribute('aria-valuenow')).toBe('500');
    // halfway in time is the middle fix: 36 km/h and the middle coordinate
    await waitFor(() => expect(screen.getByText(/36 km\/h/)).toBeTruthy());
    expect(screen.getByText('45.01000, -75.00000')).toBeTruthy();
    await waitFor(() => expect(pin()?.lngLat).toEqual([-75, 45.01]));
    expect(pin()!.on).toBe(true);
  });

  it('adds the route layer once the style has loaded', async () => {
    open();
    await waitFor(() => expect(ml.state.maps).toHaveLength(1));
    ml.state.maps[0]!.handlers.load!();
    expect(ml.state.maps[0]!.sources.route).toBeTruthy();
  });

  it('marks the start, the end and the stops, numbered in time order, the doubtful one paler', async () => {
    open();
    const marked = () => ml.state.markers.filter((m) => m.element && m.on);
    await waitFor(() => expect(marked()).toHaveLength(4));
    const at = (text: string) => marked().find((m) => m.element!.textContent === text)!;
    expect(at('Start').lngLat).toEqual([-75, 45]);
    expect(at('End').lngLat).toEqual([-75.01, 45.02]);
    expect(at('1').lngLat).toEqual([-75, 45.01]);
    expect(at('2').lngLat).toEqual([-75, 45.02]);
    expect(at('2').element!.className).toContain('opacity-60');
    expect(at('1').element!.getAttribute('aria-hidden')).toBe('true');
  });

  it('a trip picked in the timeline is drawn bold over a faded route and framed; again lets go', async () => {
    open();
    await waitFor(() => expect(ml.state.maps).toHaveLength(1));
    const map = ml.state.maps[0]!;
    map.handlers.load!();
    const tripRow = await screen.findByRole('button', { name: /^\S+Trip · 1\.0 km/ });
    const fits = map.fits.length;
    fireEvent.click(tripRow);
    await waitFor(() => expect(map.paint['route.line-opacity']).toBe(0.35));
    const picked = map.sources.picked!.data as { geometry: { coordinates: number[][] } };
    // 0 to 1,700,000 ms: the first fix, then a point on the line just before the middle fix
    expect(picked.geometry.coordinates[0]).toEqual([-75, 45]);
    expect(picked.geometry.coordinates).toHaveLength(2);
    expect(map.fits.length).toBe(fits + 1);
    fireEvent.click(tripRow);
    await waitFor(() => expect(map.paint['route.line-opacity']).toBe(1));
    expect((map.sources.picked!.data as typeof picked).geometry.coordinates).toEqual([]);
  });

  it('a stop clicked on the map is picked in the timeline, ringed and centred', async () => {
    open();
    await waitFor(() =>
      expect(ml.state.markers.filter((m) => m.element?.textContent === '2')).toHaveLength(1),
    );
    const two = ml.state.markers.find((m) => m.element?.textContent === '2')!.element!;
    fireEvent.click(two);
    const row = await screen.findByRole('button', { name: /Stop 2/ });
    expect(row.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(two.dataset.picked).toBe('true'));
    expect(ml.state.maps[0]!.eases.at(-1)).toMatchObject({ center: [-75, 45.02], zoom: 15 });
  });

  it('says so, without an error, when the server has no route (404)', async () => {
    open(settingsFixture(), { status: 404, body: { code: 'not_found' } });
    expect(
      await screen.findByText(/^No route is available for this shift\. The timeline/),
    ).toBeTruthy();
    expect(ml.state.maps).toHaveLength(0);
  });

  it('an archived route says it is simplified and has no speed', async () => {
    open(settingsFixture(), {
      body: { ...route, source: 'archive', speed_dmps: [null, null, null] },
    });
    expect(await screen.findByText(/Simplified route/)).toBeTruthy();
    expect(screen.getByText(/—/)).toBeTruthy();
  });

  it('is absent when the replay module is off', async () => {
    const { calls } = open(settingsFixture({ modules: { replay: false } }));
    await screen.findByRole('heading', { name: /Nov 14, 2023/ });
    expect(screen.queryByRole('region', { name: 'Route' })).toBeNull();
    expect(calls.some((c) => c.path.endsWith('/route'))).toBe(false);
  });

  it('shows a plain message, and keeps the page, when the map cannot start', async () => {
    ml.state.failConstructor = true;
    open();
    expect(await screen.findByText(/map could not start/)).toBeTruthy();
    expect(screen.getByLabelText('Replay position')).toBeTruthy();
  });
});

describe('map fallback', () => {
  it('uses OpenFreeMap by default and credits OpenStreetMap', async () => {
    const { default: MapView } = await import('../src/map/MapView');
    const { render } = await import('@testing-library/react');
    render(<MapView points={[]} cursor={null} styleUrl={undefined} />);
    await waitFor(() => expect(ml.state.maps).toHaveLength(1));
    const options = ml.state.maps[0]!.options as { style: unknown; attributionControl: unknown };
    expect(options.style).toMatch(/^https:\/\/tiles\.openfreemap\.org\/styles\//);
    expect(options.attributionControl).toEqual({ compact: true });
  });

  it('switches once to the blank style when the configured style cannot load', async () => {
    const { default: MapView } = await import('../src/map/MapView');
    const { render } = await import('@testing-library/react');
    render(<MapView points={[]} cursor={null} styleUrl="/tiles/style.json" />);
    await waitFor(() => expect(ml.state.maps).toHaveLength(1));
    const map = ml.state.maps[0]!;
    expect(map.options.style).toBe('/tiles/style.json');
    map.handlers.error!();
    map.handlers.error!(); // later tile errors must not reset the style again
    expect(map.setStyle).toHaveBeenCalledTimes(1);
    expect(map.setStyle.mock.calls[0]![0]).toMatchObject({ version: 8, sources: {} });
    expect(await screen.findByText(/Basemap unavailable/)).toBeTruthy();
  });
});
