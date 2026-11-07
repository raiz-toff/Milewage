import type { StyleSpecification } from 'maplibre-gl';

/** Map colours from the MileWage palette (src/index.css): card surface and Lane yellow route. */
const palette = {
  dark: { canvas: '#181b1e', route: '#ffc21f' },
  light: { canvas: '#ffffff', route: '#ffc21f' },
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
 * The map style: the configured URL (VITE_MAP_STYLE_URL, e.g. a self-hosted PMTiles style) or
 * the blank one. The URL is a build-time setting; no public tile server is ever the default.
 */
export function chooseStyle(url: string | undefined, dark: boolean): string | StyleSpecification {
  const trimmed = url?.trim();
  return trimmed ? trimmed : blankStyle(dark);
}

export const routeColor = (dark: boolean) => (dark ? palette.dark : palette.light).route;

/** The app's theme (the `.dark` class set by src/theme.ts), not the OS setting. */
export const isDarkTheme = () =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
