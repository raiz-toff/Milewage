import { View } from 'react-native';
import { useTheme } from '../theme/theme';

interface Props {
  /** GeoJSON `LineString` text from the shift row, or null. */
  geojson: string | null;
  width: number;
  height: number;
}

const THICK = 3;

/**
 * A route as a polyline on a plain background (15 section 4: no basemap offline). Each segment is
 * a thin rotated view, so no graphics library is needed; routes are simplified to a few hundred
 * points by the engine. Longitude is scaled by cos(latitude) so the shape is not stretched.
 */
export function RouteView({ geojson, width, height }: Props) {
  const theme = useTheme();
  const pts = parse(geojson);
  if (pts.length < 2) return null;
  const lat0 = pts.reduce((a, p) => a + p[1]!, 0) / pts.length;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const xs = pts.map((p) => p[0]! * kx);
  const ys = pts.map((p) => -p[1]!);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY, 1e-9);
  const pad = 8;
  const scale = (Math.min(width, height) - 2 * pad) / span;
  const px = xs.map((x) => pad + (x - minX) * scale);
  const py = ys.map((y) => pad + (y - minY) * scale);
  return (
    <View
      accessibilityLabel="Route"
      style={{ width, height, backgroundColor: theme.card, borderRadius: 8, overflow: 'hidden' }}
    >
      {px.slice(1).map((x, i) => {
        const x0 = px[i]!;
        const y0 = py[i]!;
        const y1 = py[i + 1]!;
        const dx = x - x0;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy);
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: (x0 + x) / 2 - len / 2,
              top: (y0 + y1) / 2 - THICK / 2,
              width: len,
              height: THICK,
              backgroundColor: theme.accent,
              transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
            }}
          />
        );
      })}
      <Dot x={px[0]!} y={py[0]!} color={theme.text} />
      <Dot x={px[px.length - 1]!} y={py[py.length - 1]!} color={theme.textMuted} />
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
