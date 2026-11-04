// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp, settingsFixture, signedIn } from './support/kit';

// MapLibre needs WebGL, which jsdom does not have; the library is replaced by a recorder.
const ml = vi.hoisted(() => {
  const state = {
    maps: [] as {
      options: { style: unknown };
      handlers: Record<string, () => void>;
      setStyle: ReturnType<typeof vi.fn>;
      sources: Record<string, unknown>;
    }[],
    failConstructor: false,
    markers: [] as { lngLat: number[] | null }[],
  };
  class Map {
    handlers: Record<string, () => void> = {};
    sources: Record<string, unknown> = {};
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
      return this.sources[id];
    }
    addSource(id: string, src: unknown) {
      this.sources[id] = src;
    }
    addLayer() {}
    fitBounds() {}
    isStyleLoaded() {
      return false;
    }
    remove() {}
  }
  class Marker {
    state = { lngLat: null as number[] | null };
    constructor() {
      state.markers.push(this.state);
    }
    setLngLat(l: number[]) {
      this.state.lngLat = l;
      return this;
    }
    addTo() {
      return this;
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

function open(settings = settingsFixture(), routeAnswer: object = { body: route }) {
  return renderApp(
    {
      ...signedIn(settings),
      'GET /shifts/1': () => ({ body: shift }),
      'GET /shifts/1/route': () => routeAnswer,
    },
    '/shifts/1',
  );
}

describe('route view', () => {
  it('draws on the blank style when no style URL is configured, and scrubs', async () => {
    open();
    await waitFor(() => expect(ml.state.maps).toHaveLength(1));
    expect(ml.state.maps[0]!.options.style).toMatchObject({ version: 8, sources: {} });
    const slider = screen.getByLabelText('Replay position') as HTMLInputElement;
    expect(screen.getByText(/0 km\/h/)).toBeTruthy();
    fireEvent.change(slider, { target: { value: '500' } });
    // halfway in time is the middle fix: 36 km/h and the middle coordinate
    await waitFor(() => expect(screen.getByText(/36 km\/h/)).toBeTruthy());
    expect(screen.getByText('45.01000, -75.00000')).toBeTruthy();
    await waitFor(() => expect(ml.state.markers[0]?.lngLat).toEqual([-75, 45.01]));
  });

  it('adds the route layer once the style has loaded', async () => {
    open();
    await waitFor(() => expect(ml.state.maps).toHaveLength(1));
    ml.state.maps[0]!.handlers.load!();
    expect(ml.state.maps[0]!.sources.route).toBeTruthy();
  });

  it('says so, without an error, when the server has no route (404)', async () => {
    open(settingsFixture(), { status: 404, body: { code: 'not_found' } });
    expect(await screen.findByText('No route is available for this shift.')).toBeTruthy();
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
    await screen.findByRole('heading', { name: /2023-11-14/ });
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
