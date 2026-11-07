import { View } from 'react-native';
import { useColors } from '../theme/theme';

interface Props {
  /** GeoJSON `LineString` text from the shift row, or null. */
  geojson: string | null;
  width: number;
  height: number;
}

const ROAD = 9;
const LANE = 2;

/**
 * A route as a polyline on a plain background (15 section 4: no basemap offline). Each segment is
 * a thin rotated view, so no graphics library is needed; routes are simplified to a few hundred
 * points by the engine. Longitude is scaled by cos(latitude) so the shape is not stretched.
 */
export function RouteView({ geojson, width, height }: Props) {
  const C = useColors();
  const pts = parse(geojson);
  if (pts.length < 2) return null;
  const lat0 = pts.reduce((a, p) => a + p[1]!, 0) / pts.length;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const xs = pts.map((p) => p[0]! * kx);
  const ys = pts.map((p) => -p[1]!);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY, 1e-9);
  const pad = 16;
  const scale = (Math.min(width, height) - 2 * pad) / span;
  const px = xs.map((x) => pad + (x - minX) * scale);
  const py = ys.map((y) => pad + (y - minY) * scale);
  // Drawn like the MileWage mark: an asphalt ribbon with a lane-yellow centre line.
  const segments = px.slice(1).map((x, i) => {
    const x0 = px[i]!;
    const y0 = py[i]!;
    const y1 = py[i + 1]!;
    const dx = x - x0;
    const dy = y1 - y0;
    return { cx: (x0 + x) / 2, cy: (y0 + y1) / 2, len: Math.hypot(dx, dy), a: Math.atan2(dy, dx) };
  });
  const line = (thick: number, color: string, key: string) =>
    segments.map((g, i) => (
      <View
        key={`${key}${i}`}
        style={{
          position: 'absolute',
          left: g.cx - (g.len + thick) / 2,
          top: g.cy - thick / 2,
          width: g.len + thick,
          height: thick,
          borderRadius: thick / 2,
          backgroundColor: color,
          transform: [{ rotate: `${g.a}rad` }],
        }}
      />
    ));
  return (
    <View
      accessibilityLabel="Route"
      style={{ width, height, backgroundColor: C.background, overflow: 'hidden' }}
    >
      {line(ROAD, C.secondary, 'r')}
      {line(LANE, C.primary, 'l')}
      <Dot x={px[0]!} y={py[0]!} color={C.mutedForeground} />
      <Dot x={px[px.length - 1]!} y={py[py.length - 1]!} color={C.foreground} />
    </View>
  );
}

function Dot({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <View
      style={{
        position: 'absolute',
        left: x - 5,
        top: y - 5,
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: color,
      }}
    />
  );
}

function parse(text: string | null): number[][] {
  if (!text) return [];
  try {
    const g = JSON.parse(text) as { coordinates?: number[][] };
    return Array.isArray(g.coordinates) ? g.coordinates : [];
  } catch {
    return [];
  }
}
