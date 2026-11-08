/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Optional MapLibre style URL (for example a self-hosted PMTiles style). Blank = no basemap. */
  readonly VITE_MAP_STYLE_URL?: string;
}
