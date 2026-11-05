import { useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MapLibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { lineOf } from './route';
import type { RoutePoint } from './route';
import { blankStyle, chooseStyle, routeColor } from './style';

const dark = () =>
  typeof window === 'undefined' || !window.matchMedia
    ? true
    : !window.matchMedia('(prefers-color-scheme: light)').matches;

/**
 * The map of the live screen. Unlike the replay map it is created once: new points only update
 * the line and move the marker. `follow` keeps the newest point in view. Loaded lazily.
 */
export default function LiveMap({
  trail,
  follow,
  styleUrl = import.meta.env.VITE_MAP_STYLE_URL as string | undefined,
}: {
  trail: RoutePoint[];
  follow: boolean;
  styleUrl?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const ready = useRef(false);
  const latest = useRef({ trail, follow });
  latest.current = { trail, follow };
  const [failed, setFailed] = useState(false);

  const paint = () => {
    const m = map.current;
    const { trail: t, follow: f } = latest.current;
    const last = t[t.length - 1];
    if (!m || !ready.current) return;
    (m.getSource('trail') as GeoJSONSource | undefined)?.setData(lineOf(t));
    if (last && marker.current) {
      marker.current.setLngLat([last.lon, last.lat]).addTo(m);
      if (f) m.easeTo({ center: [last.lon, last.lat], duration: 500 });
    }
  };

  useEffect(() => {
    let cancelled = false;
    const isDark = dark();
    void (async () => {
      try {
        const ml = await import('maplibre-gl');
        if (cancelled || !box.current) return;
        const m = new ml.Map({
          container: box.current,
          style: chooseStyle(styleUrl, isDark),
          attributionControl: false,
          zoom: 14,
        });
        map.current = m;
        marker.current = new ml.Marker({ color: routeColor(isDark) });
        const start = () => {
          if (m.getSource('trail')) return;
          m.addSource('trail', { type: 'geojson', data: lineOf([]) });
          m.addLayer({
            id: 'trail',
            type: 'line',
            source: 'trail',
            paint: { 'line-color': routeColor(isDark), 'line-width': 4 },
          });
          ready.current = true;
          const first = latest.current.trail[0];
          if (first) m.jumpTo({ center: [first.lon, first.lat] });
          paint();
        };
        m.on('load', start);
        m.on('error', () => {
          if (styleUrl && !m.isStyleLoaded() && !cancelled) {
            ready.current = false;
            m.setStyle(blankStyle(isDark));
            m.once('styledata', start);
          }
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      ready.current = false;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
  }, [styleUrl]);

  useEffect(paint, [trail, follow]);

  if (failed) {
    return (
      <p role="status" className="rounded border border-line bg-card p-4 text-muted">
        The map could not start in this browser. The figures still update.
      </p>
    );
  }
  return (
    <div ref={box} data-testid="map" className="h-[28rem] w-full rounded border border-line" />
  );
}
