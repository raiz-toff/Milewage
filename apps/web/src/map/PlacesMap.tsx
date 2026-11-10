import { useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MapLibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { blankStyle, casingColor, chooseStyle, isDarkTheme, routeColor } from './style';

/** A circle on the map: a centre in degrees and a radius in metres. */
export interface MapCircle {
  id: number | 'draft';
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
}

type MapLibre = typeof import('maplibre-gl');
type Feature = {
  type: 'Feature';
  properties: { id: string };
  geometry: { type: 'Polygon'; coordinates: number[][][] };
};

/** A circle as a 64-sided polygon (GeoJSON has no circles); metres to degrees on a sphere. */
export function circleOf(c: MapCircle): Feature {
  const ring: number[][] = [];
  const dLat = c.radiusM / 111_320;
  const dLon = c.radiusM / (111_320 * Math.max(Math.cos((c.lat * Math.PI) / 180), 0.01));
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    ring.push([c.lon + dLon * Math.sin(a), c.lat + dLat * Math.cos(a)]);
  }
  return {
    type: 'Feature',
    properties: { id: String(c.id) },
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}
const collection = (list: MapCircle[]) => ({
  type: 'FeatureCollection' as const,
  features: list.map(circleOf),
});

const LABEL =
  'pointer-events-none rounded-full border border-outline-variant bg-surface-container-high px-2 py-0.5 text-label-small whitespace-nowrap text-on-surface';

/**
 * The driver's places as circles over the basemap the build configures (the same as the route
 * map; nothing else is fetched: no geocoder, no address search). A click on the map, or dragging
 * the marker, sets the centre of the place being added or edited (`draft`). The form beside it is
 * the accessible way in: the centre can be typed there too, and the list names every place, so
 * the map's tags and marker are hidden from screen readers. Loaded lazily with the map library.
 */
export default function PlacesMap({
  places,
  draft,
  fallback,
  onPick,
  styleUrl = import.meta.env.VITE_MAP_STYLE_URL as string | undefined,
}: {
  places: MapCircle[];
  /** The place being added or moved; null while no centre is chosen. */
  draft: MapCircle | null;
  /** Where to look when there is no place and no draft yet (a recent route), as [lon, lat] pairs. */
  fallback: [number, number][];
  onPick: (lat: number, lon: number) => void;
  styleUrl?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const first = useRef({ places, draft, fallback });
  const [lib, setLib] = useState<MapLibre | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [blank, setBlank] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let fell = false;
    const dark = isDarkTheme();
    const style = chooseStyle(styleUrl, dark);
    const remote = typeof style === 'string';
    void (async () => {
      try {
        const ml = await import('maplibre-gl');
        if (cancelled || !box.current) return;
        const m = new ml.Map({
          container: box.current,
          style,
          center: [0, 20],
          zoom: 1,
          attributionControl: remote ? { compact: true } : false,
        });
        map.current = m;
        const draw = () => {
          if (m.getSource('places')) return;
          const color = routeColor(dark);
          m.addSource('places', { type: 'geojson', data: collection([]) });
          m.addSource('draft', { type: 'geojson', data: collection([]) });
          m.addLayer({
            id: 'places-fill',
            type: 'fill',
            source: 'places',
            paint: { 'fill-color': color, 'fill-opacity': 0.18 },
          });
          m.addLayer({
            id: 'places-line',
            type: 'line',
            source: 'places',
            paint: { 'line-color': casingColor(dark), 'line-width': 1.5 },
          });
          m.addLayer({
            id: 'draft-fill',
            type: 'fill',
            source: 'draft',
            paint: { 'fill-color': color, 'fill-opacity': 0.35 },
          });
          m.addLayer({
            id: 'draft-line',
            type: 'line',
            source: 'draft',
            paint: { 'line-color': casingColor(dark), 'line-width': 2.5 },
          });
          // First view: the place being edited, else every place, else the recent route.
          const f = first.current;
          const pts: [number, number][] = f.draft
            ? [[f.draft.lon, f.draft.lat]]
            : f.places.length
              ? f.places.map((p) => [p.lon, p.lat])
              : f.fallback;
          if (pts.length === 1) m.jumpTo({ center: pts[0]!, zoom: 15 });
          else if (pts.length > 1) {
            const lons = pts.map((p) => p[0]);
            const lats = pts.map((p) => p[1]);
            m.fitBounds(
              [
                [Math.min(...lons), Math.min(...lats)],
                [Math.max(...lons), Math.max(...lats)],
              ],
              { padding: 48, duration: 0, maxZoom: 15 },
            );
          }
          setReady(true);
        };
        m.on('load', draw);
        m.on('error', () => {
          if (remote && !fell && !m.isStyleLoaded() && !cancelled) {
            fell = true;
            setBlank(true);
            m.setStyle(blankStyle(dark));
            m.once('styledata', draw);
          }
        });
        m.on('click', (e) => pickRef.current(e.lngLat.lat, e.lngLat.lng));
        const mk = new ml.Marker({ color: routeColor(dark), draggable: true });
        mk.getElement().setAttribute('aria-hidden', 'true');
        mk.on('dragend', () => {
          const at = mk.getLngLat();
          pickRef.current(at.lat, at.lng);
        });
        marker.current = mk;
        setLib(ml);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
      setLib(null);
      setReady(false);
    };
  }, [styleUrl]);

  // The saved places, and a small name tag at each centre.
  useEffect(() => {
    const m = map.current;
    if (!lib || !m || !ready) return;
    (m.getSource('places') as GeoJSONSource | undefined)?.setData(
      collection(places.filter((p) => p.id !== draft?.id)),
    );
    const tags = places
      .filter((p) => p.id !== draft?.id)
      .map((p) => {
        const el = document.createElement('div');
        el.textContent = p.name;
        el.className = LABEL;
        el.setAttribute('aria-hidden', 'true');
        return new lib.Marker({ element: el, anchor: 'bottom', offset: [0, -4] })
          .setLngLat([p.lon, p.lat])
          .addTo(m);
      });
    return () => tags.forEach((t) => t.remove());
  }, [lib, ready, places, draft?.id]);

  // The place being added or moved: its circle and the draggable marker.
  useEffect(() => {
    const m = map.current;
    if (!lib || !m || !ready) return;
    (m.getSource('draft') as GeoJSONSource | undefined)?.setData(collection(draft ? [draft] : []));
    if (draft) {
      marker.current?.setLngLat([draft.lon, draft.lat]).addTo(m);
      if (!m.getBounds().contains([draft.lon, draft.lat])) {
        m.easeTo({ center: [draft.lon, draft.lat], zoom: Math.max(m.getZoom(), 15), duration: 0 });
      }
    } else marker.current?.remove();
  }, [lib, ready, draft]);

  if (failed) {
    return (
      <p role="status" className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        The map could not start in this browser. Type the centre of the place in the form instead.
      </p>
    );
  }
  return (
    <div>
      <div
        ref={box}
        data-testid="places-map"
        className="h-72 w-full cursor-crosshair overflow-hidden rounded-xl border sm:h-96"
      />
      {blank ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Basemap unavailable; your places are drawn on a plain background.
        </p>
      ) : null}
    </div>
  );
}
