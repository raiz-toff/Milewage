import type { StyleSpecification } from 'maplibre-gl';
import { colors } from '@milewage/shared/src/tokens';

/**
 * A style with no basemap: one plain background and nothing to download (05 section 3.2).
 * The route and markers are drawn over it, so the map works with no tile server at all.
 */
export function blankStyle(dark: boolean): StyleSpecification {
  const c = dark ? colors.dark : colors.light;
  return {
    version: 8,
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': c.card } }],
  };
}

/**
 * The map style: the configured URL (VITE_MAP_STYLE_URL, e.g. a self-hosted PMTiles style) or
 * the blank one. The URL is a build-time setting; no public tile server is ever the default.
 */
export function chooseStyle(url: string | undefined, dark: boolean): string | StyleSpecification {
  const trimmed = url?.trim();
  return trimmed ? trimmed : blankStyle(dark);
}

export const routeColor = (dark: boolean) => (dark ? colors.dark.accent : colors.light.accent);
