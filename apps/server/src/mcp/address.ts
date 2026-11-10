import type { FastifyRequest } from 'fastify';
import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/server';
import { API_PREFIX } from '../app';

export const MCP_PATH = `${API_PREFIX}/mcp`;

/** The addresses the owner configured: `MILEWAGE_PUBLIC_URL` and `MILEWAGE_HOME_URL`, or null. */
export interface ConfiguredAddresses {
  publicUrl: string | null;
  homeUrl: string | null;
}

/** `host` as it appears in an address with this scheme (a default port dropped, lower case). */
function hostIn(protocol: string, host: string): string | null {
  return URL.parse(`${protocol}//${host}`)?.host ?? null;
}

/**
 * The address an assistant used to reach this server, which the sign-in documents must repeat
 * exactly (RFC 9728 section 3.3). A configured address wins when the request came for its host:
 * a proxy Caddy does not trust loses the https of the address the client typed, and the client
 * then refuses the documents. A request for any other host (the home network's IP address, say)
 * gets its own address, so each way in keeps working.
 */
export function mcpAddresses(known: ConfiguredAddresses) {
  const origin = (req: FastifyRequest) => {
    for (const url of [known.publicUrl, known.homeUrl]) {
      if (!url) continue;
      const u = new URL(url);
      if (hostIn(u.protocol, req.host) === u.host) return u.origin;
    }
    return `${req.protocol}://${req.host}`;
  };
  const mcpUrl = (req: FastifyRequest) => `${origin(req)}${MCP_PATH}`;
  return {
    origin,
    mcpUrl,
    /** Where the 401 from `/mcp` points a client to start (RFC 9728 section 5.1). */
    resourceMetadataUrl: (req: FastifyRequest) =>
      getOAuthProtectedResourceMetadataUrl(new URL(mcpUrl(req))),
  };
}

export type ConnectionFinding =
  | 'wrong_address'
  | 'host_changed'
  | 'proxy_not_trusted'
  | 'forwarded_proto_missing'
  | 'own_certificate';

export interface ConnectionCheck {
  ok: boolean;
  /** The address the browser is on, as given. */
  address: string;
  /** What assistants are told to use, in the sign-in documents and the 401. */
  mcp_url: string;
  /** What reached the API after every proxy. */
  seen: { protocol: string; host: string; via: string | null };
  public_url: string | null;
  home_url: string | null;
  findings: { code: ConnectionFinding; message: string }[];
}

/**
 * Settings › AI assistants › Test connection. Compares the address the browser is on with what
 * reached the API, and names the first cause in plain words. `via` is the left end of
 * X-Forwarded-For as Caddy passed it: one entry means Caddy did not trust the sender (it replaces
 * the header with the sender's address), two or more mean it kept a trusted proxy's list.
 */
export function checkConnection(
  req: FastifyRequest,
  address: URL,
  known: ConfiguredAddresses,
): ConnectionCheck {
  const { mcpUrl } = mcpAddresses(known);
  const told = mcpUrl(req);
  const hops = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = { protocol: req.protocol, host: req.host, via: hops[0] ?? null };
  const findings: ConnectionCheck['findings'] = [];
  const add = (code: ConnectionFinding, message: string) => findings.push({ code, message });
  const ok = told === `${address.origin}${MCP_PATH}`;

  if (!ok) {
    add(
      'wrong_address',
      `Assistants are told to use ${told}, but you opened MileWage at ${address.origin}. An assistant refuses an address that differs from the one it was given.`,
    );
  }
  if (hostIn(address.protocol, req.host) !== address.host) {
    add(
      'host_changed',
      `The proxy in front of MileWage changes the host name: you opened ${address.host}, MileWage saw ${req.host}. Have the proxy pass the Host header on unchanged (in Nginx: proxy_set_header Host $host).`,
    );
  }
  if (address.protocol === 'https:' && req.protocol !== 'https') {
    if (hops.length >= 2) {
      add(
        'forwarded_proto_missing',
        'You opened MileWage over https, but the proxy in front of it did not say so. Have the proxy send X-Forwarded-Proto (in Nginx: proxy_set_header X-Forwarded-Proto $scheme).',
      );
    } else {
      const from = hops[0] ? ` The request came from ${hops[0]}.` : '';
      add(
        'proxy_not_trusted',
        `You opened MileWage over https, but MileWage saw http: the proxy in front of it is not trusted, so its X-Forwarded-Proto header was dropped.${from} Put the proxy's address in MILEWAGE_TRUSTED_PROXIES in infra/docker/.env and restart MileWage.`,
      );
    }
  }
  if (
    address.protocol === 'https:' &&
    !address.hostname.endsWith('.ts.net') &&
    !/^[\d.]+$|^\[/.test(address.hostname)
  ) {
    const labels = address.hostname.split('.').length;
    const wildcard =
      labels <= 2
        ? ` It must also name ${address.hostname} itself: Node does not accept a wildcard such as *.${address.hostname.split('.').slice(1).join('.') || address.hostname}.`
        : '';
    add(
      'own_certificate',
      `If this certificate comes from your own certificate authority, an assistant that runs on Node.js (Claude Code, mcp-remote) does not trust it until you set NODE_EXTRA_CA_CERTS to the authority's certificate file before starting the assistant.${wildcard}`,
    );
  }
  return {
    ok,
    address: address.origin,
    mcp_url: told,
    seen,
    public_url: known.publicUrl,
    home_url: known.homeUrl,
    findings,
  };
}
