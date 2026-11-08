/**
 * Announces this server on the home network (plan 28 section 4.6) as `_milewage._tcp` over mDNS /
 * DNS-SD (RFC 6762, RFC 6763), so the phone can find it on the Wi-Fi. It runs beside the API, not
 * in it: in Docker the API sits on a bridge network that multicast does not cross, so the
 * advertiser runs in its own container with the host's network (`advertise-main.ts`). It announces
 * only while the server answers `/healthz`, with the server's instance id in the TXT record so the
 * phone can tell two servers apart and recognise its own later. Nothing else is in the record.
 */

/** The DNS-SD service type: `_milewage._tcp` (RFC 6335 section 5.1: at most 15 characters). */
export const SERVICE_TYPE = 'milewage';

/** What the phone reads: the record's version, the instance id when set up, and the web path. */
export function txtRecord(instanceId: string | null): Record<string, string> {
  return instanceId ? { v: '1', id: instanceId, path: '/' } : { v: '1', path: '/' };
}

/** A DNS-SD instance name is one label of at most 63 bytes (RFC 6763 section 4.1.1). */
export function serviceName(host: string): string {
  const name = `MileWage (${host.split('.')[0] || 'server'})`;
  return Buffer.byteLength(name) <= 63 ? name : 'MileWage';
}

/** The slice of ciao's service this uses, so tests can watch it without the network. */
export interface Announced {
  advertise(): Promise<void>;
  updateTxt(txt: Record<string, string>): void;
  end(): Promise<void>;
  destroy(): Promise<void>;
}
export interface Announcer {
  createService(o: {
    name: string;
    type: string;
    port: number;
    txt: Record<string, string>;
  }): Announced;
  shutdown(): Promise<void>;
}

export interface AdvertiserOptions {
  name: string;
  /** The port phones connect to: Caddy's published port, or the dev server's. */
  port: number;
  /** The server's health: `{ok, instanceId}`; not ok stops the announcement. */
  check: () => Promise<{ ok: boolean; instanceId: string | null }>;
  announcer: Announcer;
  log?: (message: string) => void;
}

/** Announces while healthy, follows the instance id, and goes quiet when the server is down. */
export function createAdvertiser(o: AdvertiserOptions) {
  let service: Announced | null = null;
  let current: string | null = null;
  const log = o.log ?? (() => {});
  return {
    get announced() {
      return service !== null;
    },
    /** One look at the server; call it on a timer. */
    async tick() {
      const { ok, instanceId } = await o.check();
      if (!ok) {
        if (service) {
          const s = service;
          service = null;
          await s.end(); // goodbye packets (RFC 6762 section 10.1)
          await s.destroy();
          log('server not answering; announcement withdrawn');
        }
        return;
      }
      if (!service) {
        service = o.announcer.createService({
          name: o.name,
          type: SERVICE_TYPE,
          port: o.port,
          txt: txtRecord(instanceId),
        });
        current = instanceId;
        await service.advertise();
        log(`announcing _${SERVICE_TYPE}._tcp "${o.name}" on port ${o.port}`);
      } else if (instanceId !== current) {
        current = instanceId;
        service.updateTxt(txtRecord(instanceId));
      }
    },
    async stop() {
      const s = service;
      service = null;
      if (s) await s.end();
      await o.announcer.shutdown();
    },
  };
}

/** `/healthz` of the server, with the instance id from its `X-MileWage-Instance` header. */
export async function checkHealth(url: string, fetchFn: typeof fetch = fetch) {
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(3000) });
    return { ok: res.ok, instanceId: res.headers.get('x-milewage-instance') };
  } catch {
    return { ok: false, instanceId: null };
  }
}
