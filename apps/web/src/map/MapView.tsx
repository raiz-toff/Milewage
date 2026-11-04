import { useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { boundsOf, lineOf } from './route';
import type { RoutePoint } from './route';
import { blankStyle, chooseStyle, routeColor } from './style';

const dark = () =>
  typeof window === 'undefined' || !window.matchMedia
    ? true
    : !window.matchMedia('(prefers-color-scheme: light)').matches;

/**
 * The route over a plain background, or over the configured style. If the style cannot load
 * (no tile server, wrong URL) the map switches once to the blank style and keeps the route.
 * Loaded lazily, so the 700 kB map library is not part of the main bundle.
 */
export default function MapView({
  points,
  cursor,
  styleUrl = import.meta.env.VITE_MAP_STYLE_URL as string | undefined,
}: {
  points: RoutePoint[];
  cursor: RoutePoint | null;
  styleUrl?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const [failed, setFailed] = useState(false);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let fell = false;
    const isDark = dark();
    const color = routeColor(isDark);
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
          style: chooseStyle(styleUrl, isDark),
          attributionControl: false,
        });
        map.current = m;
        const draw = () => {
          if (m.getSource('route')) return;
          m.addSource('route', { type: 'geojson', data: lineOf(points) });
          m.addLayer({
            id: 'route',
            type: 'line',
            source: 'route',
            paint: { 'line-color': color, 'line-width': 4 },
          });
          const b = boundsOf(points);
          if (b)
            m.fitBounds(
              [
                [b[0], b[1]],
                [b[2], b[3]],
              ],
              { padding: 40, duration: 0 },
            );
        };
        m.on('load', draw);
        m.on('error', () => {
          // A style or tile that cannot be fetched: fall back once to the plain background.
          if (styleUrl && !fell && !m.isStyleLoaded() && !cancelled) {
            fell = true;
            setFallback(true);
            m.setStyle(blankStyle(isDark));
            m.once('styledata', draw);
          }
        });
        marker.current = new ml.Marker({ color });
        place();
      } catch {
        if (!cancelled) setFailed(true); // no WebGL, or the library did not load
      }
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
  }, [points, styleUrl]);

  useEffect(() => {
    if (cursor && map.current && marker.current) {
      marker.current.setLngLat([cursor.lon, cursor.lat]).addTo(map.current);
    }
  }, [cursor]);

  if (failed) {
    return (
      <p role="status" className="rounded border border-line bg-card p-4 text-muted">
        The map could not start in this browser. The route figures below still work.
      </p>
    );
  }
  return (
    <div>
      <div ref={box} data-testid="map" className="h-96 w-full rounded border border-line" />
      {fallback ? (
        <p className="mt-1 text-xs text-muted">Basemap unavailable; showing the route only.</p>
      ) : null}
    </div>
  );
}
