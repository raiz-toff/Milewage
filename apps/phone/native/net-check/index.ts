import { requireOptionalNativeModule } from 'expo';

export interface NetCheckModule {
  /** True when this phone's traffic goes through a VPN; null when Android cannot tell. */
  vpnActive(): boolean | null;
  /** True on Wi-Fi or Ethernet (also under a VPN), false on mobile data alone, null with no network. */
  localNetwork(): boolean | null;
  /**
   * Servers announced on this network as `type` (`_milewage._tcp`), browsed for `browseMs`
   * (plan 28): name, one address (IPv4 first), port and the TXT record as text.
   */
  discover(
    type: string,
    browseMs: number,
  ): Promise<{ name: string; host: string; port: number; txt: Record<string, string> }[]>;
  /** Only packages named under `<queries>` (Tailscale) are visible. */
  isInstalled(pkg: string): boolean;
  /** Opens the app; false when it is not installed. */
  openApp(pkg: string): boolean;
}

/** Null where the module is not built in (tests, web). */
export const loadNetCheck = () => requireOptionalNativeModule<NetCheckModule>('NetCheck');
