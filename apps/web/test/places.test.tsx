// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { centreText, parseCentre } from '../src/places';
import { shift, stop, trip } from './support/fixtures';
import { menu, renderApp, settingsFixture, signedIn } from './support/kit';

// MapLibre needs WebGL, which jsdom does not have; the library is replaced by a recorder.
const ml = vi.hoisted(() => {
  const state = { maps: [] as { handlers: Record<string, (e?: unknown) => void> }[] };
  class Map {
    handlers: Record<string, (e?: unknown) => void> = {};
    sources: Record<string, unknown> = {};
    constructor() {
      state.maps.push(this);
    }
    on(name: string, cb: (e?: unknown) => void) {
      this.handlers[name] = cb;
    }
    once(name: string, cb: () => void) {
      this.handlers[name] = cb;
    }
    getSource(id: string) {
      return this.sources[id] && { setData: (d: unknown) => (this.sources[id] = d) };
    }
    addSource(id: string, src: { data: unknown }) {
      this.sources[id] = src.data;
    }
    addLayer() {}
    jumpTo() {}
    fitBounds() {}
    easeTo() {}
    getZoom() {
      return 12;
    }
    getBounds() {
      return { contains: () => true };
    }
    isStyleLoaded() {
      return true;
    }
    remove() {}
  }
  class Marker {
    el = document.createElement('div');
    getElement() {
      return this.el;
    }
    on() {
      return this;
    }
    setLngLat() {
      return this;
    }
    getLngLat() {
      return { lat: 0, lng: 0 };
    }
    addTo() {
      return this;
    }
    remove() {}
  }
  return { state, Map, Marker };
});
vi.mock('maplibre-gl', () => ({ default: ml, Map: ml.Map, Marker: ml.Marker }));

afterEach(cleanup);
beforeEach(() => {
  ml.state.maps.length = 0;
});

const home = {
  id: 1,
  name: 'Home',
  lat_e7: 436_532_000,
  lon_e7: -793_832_000,
  radius_m: 100,
  role: 'other' as const,
  created_at: 1,
  updated_at: 1,
};
const outcome = (place: object | null, n = 1, kept = 0) => ({
  body: { place, shifts_recalculated: n, shifts_kept: kept },
});

function open(list: object[] = [home], path = '/places') {
  return renderApp(
    {
      ...signedIn(settingsFixture()),
      'GET /places': () => ({ body: list }),
      'GET /shifts': () => ({ body: { items: [], next_cursor: null } }),
      'POST /places': ({ body }) => outcome({ ...home, id: 2, ...(body as object) }),
      'PATCH /places/1': ({ body }) => outcome({ ...home, ...(body as object) }, 0, 1),
      'DELETE /places/1': () => outcome(null, 2),
    },
    path,
  );
}
const form = () => screen.getByRole('form', { name: /place/i });

describe('places page (ADR 0008)', () => {
  it('lists places with their label and radius', async () => {
    open();
    const list = await screen.findByRole('region', { name: 'Your places' });
    expect(await within(list).findByText('Home')).toBeTruthy();
    expect(within(list).getByText('Other · 100 m')).toBeTruthy();
  });

  it('adds a place from a typed centre and says which shifts were worked out again', async () => {
    const s = open([]);
    expect(await screen.findByText(/No places yet/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Pizza Place' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pickup' }));
    fireEvent.change(screen.getByLabelText('Radius (m)'), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText('Centre (latitude, longitude)'), {
      target: { value: '43.65107, -79.34702' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save place' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      'Added Pizza Place. One shift was worked out again.',
    );
    expect(s.calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Pizza Place',
      role: 'pickup',
      radius_m: 60,
      lat_e7: 436_510_700,
      lon_e7: -793_470_200,
    });
  });

  it('a click on the map sets the centre', async () => {
    open([]);
    await screen.findByText(/No places yet/);
    await waitFor(() => expect(ml.state.maps).toHaveLength(1));
    const m = ml.state.maps[0]!;
    act(() => m.handlers.load!());
    act(() => m.handlers.click!({ lngLat: { lat: 43.7, lng: -79.4 } }));
    expect((screen.getByLabelText('Centre (latitude, longitude)') as HTMLInputElement).value).toBe(
      '43.70000, -79.40000',
    );
  });

  it('refuses a place without a centre or with a radius out of range, sending nothing', async () => {
    const s = open([]);
    await screen.findByText(/No places yet/);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save place' }));
    expect((await within(form()).findByRole('alert')).textContent).toMatch(/Choose the centre/);
    fireEvent.change(screen.getByLabelText('Centre (latitude, longitude)'), {
      target: { value: '43.6, -79.3' },
    });
    fireEvent.change(screen.getByLabelText('Radius (m)'), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save place' }));
    expect((await within(form()).findByRole('alert')).textContent).toMatch(/25 to 1000/);
    expect(s.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('edits and deletes from the row menu', async () => {
    const s = open();
    await screen.findByText('Home');
    menu('Home', 'Edit');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Home');
    fireEvent.change(screen.getByLabelText('Radius (m)'), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      'Saved Home. One finalized or archived shift keeps its figures.',
    );
    expect(s.calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ radius_m: 150 });
    menu('Home', 'Delete');
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'Deleted Home. 2 shifts were worked out again.',
      ),
    );
    expect(s.calls.find((c) => c.method === 'DELETE')?.path).toBe('/places/1');
  });

  it('reads and writes centres as latitude, longitude', () => {
    expect(parseCentre('43.65107, -79.34702')).toEqual({
      lat_e7: 436_510_700,
      lon_e7: -793_470_200,
    });
    expect(parseCentre('43.6 -79.3')).toEqual({ lat_e7: 436_000_000, lon_e7: -793_000_000 });
    expect(parseCentre('91, 0')).toBeNull();
    expect(parseCentre('Main Street')).toBeNull();
    expect(centreText(436_510_700, -793_470_200)).toBe('43.65107, -79.34702');
  });
});

describe('places on a shift page', () => {
  const placed = stop(1, {
    role: 'other',
    est_role: 'pickup',
    place: { id: 1, name: 'Home', role: 'other' },
  });
  const plain = stop(2, { lat_e7: 437_000_000, lon_e7: -794_000_000, role: 'dropoff' });
  function openShift() {
    return renderApp(
      {
        ...signedIn(settingsFixture()),
        'GET /shifts/1': () => ({ body: shift() }),
        'GET /shifts/1/trips': () => ({ body: [trip(1)] }),
        'GET /shifts/1/stops': () => ({ body: [placed, plain] }),
        'GET /odometer': () => ({ body: [] }),
        'GET /places': () => ({ body: [home] }),
        'GET /shifts': () => ({ body: { items: [], next_cursor: null } }),
      },
      '/shifts/1',
    );
  }

  it('a stop in a place shows its name and the label it gave, not an estimate', async () => {
    openShift();
    const timeline = await screen.findByRole('list', { name: 'Timeline' });
    expect(await within(timeline).findByText(/Stop 1 · Other · Home/)).toBeTruthy();
    const panel = within(await screen.findByRole('region', { name: 'Stops' }));
    await panel.findByRole('table', { name: 'Detected stops' });
    expect(panel.getByText('From Home: Other')).toBeTruthy();
  });

  it('"Save as a place" opens Places with the stop\'s centre and label filled in', async () => {
    openShift();
    const panel = within(await screen.findByRole('region', { name: 'Stops' }));
    await panel.findByRole('table', { name: 'Detected stops' });
    fireEvent.click(panel.getByRole('button', { name: /^Save the stop at .* as a place$/ }));
    expect(await screen.findByRole('heading', { name: 'Places' })).toBeTruthy();
    expect((screen.getByLabelText('Centre (latitude, longitude)') as HTMLInputElement).value).toBe(
      '43.70000, -79.40000',
    );
    expect(screen.getByRole('button', { name: 'Dropoff' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});
