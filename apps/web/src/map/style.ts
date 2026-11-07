import type { StyleSpecification } from 'maplibre-gl';

/**
 * Map colours from the MileWage palette (src/index.css): card surface, Lane yellow route, and an
 * Asphalt edge under the route so yellow stays visible on a light basemap.
 */
const palette = {
  dark: { canvas: '#181b1e', route: '#ffc21f', casing: '#101214' },
  light: { canvas: '#ffffff', route: '#ffc21f', casing: '#101214' },
} as const;

/**
 * The default basemap: OpenFreeMap, free public vector tiles with no key and no usage limit
 * (owner decision 2026-11-07, replacing the blank default of 05 section 3.2). The tile server
 * learns which area is viewed, not the route, which is drawn locally.
 */
export const OPENFREEMAP = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
} as const;

/**
 * A style with no basemap: one plain background and nothing to download (05 section 3.2).
 * The route and markers are drawn over it, so the map works with no tile server at all.
 */
export function blankStyle(dark: boolean): StyleSpecification {
  const c = dark ? palette.dark : palette.light;
  return {
    version: 8,
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': c.canvas } }],
  };
}

/**
 * The map style: OpenFreeMap for the theme, unless the build sets VITE_MAP_STYLE_URL to another
 * style (e.g. a self-hosted PMTiles one) or to `none` for the blank background.
 */
export function chooseStyle(url: string | undefined, dark: boolean): string | StyleSpecification {
  const trimmed = url?.trim();
  if (trimmed === 'none') return blankStyle(dark);
  if (trimmed) return trimmed;
  return dark ? OPENFREEMAP.dark : OPENFREEMAP.light;
}

export const routeColor = (dark: boolean) => (dark ? palette.dark : palette.light).route;
export const casingColor = (dark: boolean) => (dark ? palette.dark : palette.light).casing;

/** The app's theme (the `.dark` class set by src/theme.ts), not the OS setting. */
export const isDarkTheme = () =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
