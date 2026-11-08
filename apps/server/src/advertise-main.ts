/**
 * `node advertise.mjs` (plan 28 section 4.6): announces the MileWage server on the home network.
 * Docker: the `lan-discovery` service runs it with the host's network, only with LAN access on.
 * `npm run dev --host`: `scripts/dev.mjs` runs it. Settings:
 *   MILEWAGE_ADVERTISE_PORT  the port phones connect to (default 8080, Caddy's published port)
 *   MILEWAGE_HEALTH_URL      where to check the server (default http://127.0.0.1:<port>/healthz)
 *   MILEWAGE_ADVERTISE_NAME  the name phones show (default "MileWage (<host name>)")
 */
import { hostname } from 'node:os';
import { getResponder } from '@homebridge/ciao';
import { checkHealth, createAdvertiser, serviceName, type Announcer } from './lan/advertise';

const port = Number(process.env.MILEWAGE_ADVERTISE_PORT ?? '8080');
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(
    `MILEWAGE_ADVERTISE_PORT must be a port number, got "${process.env.MILEWAGE_ADVERTISE_PORT}".`,
  );
  process.exit(1);
}
const health = process.env.MILEWAGE_HEALTH_URL || `http://127.0.0.1:${port}/healthz`;
const advertiser = createAdvertiser({
  name: process.env.MILEWAGE_ADVERTISE_NAME || serviceName(hostname()),
  port,
  check: () => checkHealth(health),
  announcer: getResponder() as unknown as Announcer,
  log: (m) => console.log(`[lan-discovery] ${m}`),
});

const tick = () => advertiser.tick().catch((e: unknown) => console.error('[lan-discovery]', e));
void tick();
const timer = setInterval(tick, 15_000);
const stop = () => {
  clearInterval(timer);
  void advertiser.stop().finally(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
