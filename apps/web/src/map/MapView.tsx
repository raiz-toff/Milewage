import { useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { boundsOf, lineOf, segmentOf } from './route';
import type { RoutePoint } from './route';
import { blankStyle, casingColor, chooseStyle, isDarkTheme, routeColor } from './style';

const dark = isDarkTheme;

/** A stop drawn on the map: its number in the timeline, where it is, and whether it is doubtful. */
export interface MapStop {
  key: string;
  n: number;
  lat: number;
  lon: number;
  low: boolean;
}
/** What is picked: a trip by its time range, or a stop by its key. */
export type MapPick = { trip: [number, number] } | { stop: string } | null;

type MapLibre = typeof import('maplibre-gl');

/** A marker's element. The timeline is the accessible way in, so markers are hidden from it. */
function markerElement(text: string, className: string) {
  const el = document.createElement('div');
  el.textContent = text;
  el.className = className;
  el.setAttribute('aria-hidden', 'true');
  return el;
}
const STOP =
  'grid size-6 cursor-pointer place-items-center rounded-full border-2 border-background bg-foreground text-label-small text-background shadow-sm tabular-nums data-[picked=true]:ring-3 data-[picked=true]:ring-primary';
const END = 'rounded-full border bg-background px-1.5 text-label-small text-foreground';

const fitTo = (m: MapLibreMap, points: RoutePoint[], duration: number) => {
  const b = boundsOf(points);
  if (b) m.fitBounds(b, { padding: 48, duration, maxZoom: 16 });
};
/**
 * The route over the basemap (OpenFreeMap unless the build configures another style), with the
 * start, the end and the numbered stops. A picked trip is drawn bold over a faded route and
 * framed; a picked stop is ringed and centred; clicking a stop picks it. If the style cannot load
 * (offline, tile server down, wrong URL) the map switches once to the blank style and keeps the
 * route. Loaded lazily, so the 700 kB map library is not in the main bundle.
 */
export default function MapView({
  points,
  cursor,
  stops = [],
  pick = null,
  onPickStop,
  styleUrl = import.meta.env.VITE_MAP_STYLE_URL as string | undefined,
}: {
  points: RoutePoint[];
  cursor: RoutePoint | null;
  stops?: MapStop[];
  pick?: MapPick;
  onPickStop?: (key: string) => void;
  styleUrl?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const onPickRef = useRef(onPickStop);
  onPickRef.current = onPickStop;
  const stopMarks = useRef(new Map<string, HTMLElement>());
  const shown = useRef('');
  const [lib, setLib] = useState<MapLibre | null>(null);
  const [failed, setFailed] = useState(false);
  const [fallback, setFallback] = useState(false);

  /** Draws the pick: the trip's part bold over a faded route. Safe to call before the style loads. */
  const paint = () => {
    const m = map.current;
    const p = pickRef.current;
    const src = m?.getSource('picked') as { setData?: (d: unknown) => void } | undefined;
    if (!m || !src?.setData) return;
    const seg = p && 'trip' in p ? segmentOf(points, p.trip[0], p.trip[1]) : [];
    src.setData(lineOf(seg));
    for (const id of ['route', 'route-casing']) {
      m.setPaintProperty(id, 'line-opacity', seg.length ? 0.35 : 1);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let fell = false;
    const isDark = dark();
    const color = routeColor(isDark);
    const style = chooseStyle(styleUrl, isDark);
    const remote = typeof style === 'string';
    const place = () => {
      const c = cursorRef.current;
      if (c && map.current && marker.current) {
        marker.current.setLngLat([c.lon, c.lat]).addTo(map.current);
      }
    };
    void (async () => {
      try {
        const ml = await import('maplibre-gl');
        if (cancelled || !box.current) return;
        const m = new ml.Map({
          container: box.current,
          style,
          // OpenStreetMap data must be credited; compact keeps it to an (i) button.
          attributionControl: remote ? { compact: true } : false,
        });
        map.current = m;
        const draw = () => {
          if (m.getSource('route')) return;
          m.addSource('route', { type: 'geojson', data: lineOf(points) });
          m.addSource('picked', { type: 'geojson', data: lineOf([]) });
          const line = (id: string, source: string, paint: Record<string, unknown>) =>
            m.addLayer({
              id,
              type: 'line',
              source,
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint,
            });
          line('route-casing', 'route', { 'line-color': casingColor(isDark), 'line-width': 7 });
          line('route', 'route', { 'line-color': color, 'line-width': 4 });
          line('picked-casing', 'picked', { 'line-color': casingColor(isDark), 'line-width': 10 });
          line('picked', 'picked', { 'line-color': color, 'line-width': 6 });
          fitTo(m, points, 0);
          paint();
        };
        m.on('load', draw);
        m.on('error', () => {
          // A style or tile that cannot be fetched: fall back once to the plain background.
          if (remote && !fell && !m.isStyleLoaded() && !cancelled) {
            fell = true;
            setFallback(true);
            m.setStyle(blankStyle(isDark));
            m.once('styledata', draw);
          }
        });
        const ends = [
          [points[0], 'Start', 'bottom', -4],
          [points[points.length - 1], 'End', 'top', 4],
        ] as const;
        for (const [p, text, anchor, dy] of ends) {
          if (p)
            new ml.Marker({ element: markerElement(text, END), anchor, offset: [0, dy] })
              .setLngLat([p.lon, p.lat])
              .addTo(m);
        }
        marker.current = new ml.Marker({ color });
        place();
        setLib(ml);
      } catch {
        if (!cancelled) setFailed(true); // no WebGL, or the library did not load
      }
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
      shown.current = '';
      setLib(null);
    };
  }, [points, styleUrl]);

  // Stops: one numbered marker each, redrawn when the list changes.
  useEffect(() => {
    const m = map.current;
    if (!lib || !m) return;
    const marks = stopMarks.current;
    const made = stops.map((s) => {
      const el = markerElement(String(s.n), STOP + (s.low ? ' opacity-60' : ''));
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onPickRef.current?.(s.key);
      });
      marks.set(s.key, el);
      return new lib.Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(m);
    });
    return () => {
      made.forEach((mk) => mk.remove());
      marks.clear();
    };
  }, [lib, stops]);

  // The pick: bold trip and framed, or ringed stop and centred; letting go frames the route.
  const pickKey = pick === null ? '' : 'trip' in pick ? `t${pick.trip.join('-')}` : `s${pick.stop}`;
  useEffect(() => {
    const m = map.current;
    if (!lib || !m) return;
    const p = pickRef.current;
    for (const [key, el] of stopMarks.current) {
      const on = p !== null && 'stop' in p && p.stop === key;
      el.dataset.picked = String(on);
      el.style.zIndex = on ? '2' : '';
    }
    paint();
    if (pickKey === shown.current) return;
    const was = shown.current;
    shown.current = pickKey;
    const duration = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 500;
    if (p && 'trip' in p) fitTo(m, segmentOf(points, p.trip[0], p.trip[1]), duration);
    else if (p && 'stop' in p) {
      const s = stops.find((x) => x.key === p.stop);
      if (s) m.easeTo({ center: [s.lon, s.lat], zoom: Math.max(m.getZoom(), 15), duration });
    } else if (was) fitTo(m, points, duration);
  }, [lib, pickKey, stops, points]);

  useEffect(() => {
    if (cursor && map.current && marker.current) {
      marker.current.setLngLat([cursor.lon, cursor.lat]).addTo(map.current);
    } else marker.current?.remove();
  }, [cursor]);

  if (failed) {
    return (
      <p
        role="status"
        className="rounded-xl border border-outline-variant p-4 text-body-medium text-muted-foreground"
      >
        The map could not start in this browser. The timeline lists the same trips and stops.
      </p>
    );
  }
  return (
    <div>
      <div
        ref={box}
        data-testid="map"
        className="h-72 w-full overflow-hidden rounded-xl border sm:h-96"
      />
      {fallback ? (
        <p className="mt-1 text-body-small text-muted-foreground">
          Basemap unavailable; showing the route only.
        </p>
      ) : null}
    </div>
  );
}
