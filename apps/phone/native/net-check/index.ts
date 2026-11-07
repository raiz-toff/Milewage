import { requireOptionalNativeModule } from 'expo';

export interface NetCheckModule {
  /** True when this phone's traffic goes through a VPN; null when Android cannot tell. */
  vpnActive(): boolean | null;
  /** Only packages named under `<queries>` (Tailscale) are visible. */
  isInstalled(pkg: string): boolean;
  /** Opens the app; false when it is not installed. */
  openApp(pkg: string): boolean;
}

/** Null where the module is not built in (tests, web). */
export const loadNetCheck = () => requireOptionalNativeModule<NetCheckModule>('NetCheck');
