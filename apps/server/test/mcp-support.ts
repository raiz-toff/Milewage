import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { harness, type Harness } from './support';

/** The official v2 client, talking to the harness through `inject` (no network). */
export async function connect(h: Harness, token: string, extra: Record<string, string> = {}) {
  const fetch = async (url: string | URL, init?: RequestInit) => {
    const res = await h.app.inject({
      method: (init?.method ?? 'GET') as 'POST',
      url: new URL(url).pathname,
      headers: {
        ...Object.fromEntries(new Headers(init?.headers)),
        authorization: `Bearer ${token}`,
        ...extra,
      },
      payload: init?.body as string | undefined,
    });
    const headers = new Headers();
    for (const [k, v] of Object.entries(res.headers))
      if (v !== undefined) headers.set(k, String(v));
    const empty = [204, 205, 304].includes(res.statusCode);
    return new Response(empty ? null : new Uint8Array(res.rawPayload), {
      status: res.statusCode,
      headers,
    });
  };
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://mw.test/api/v1/mcp'), { fetch }),
  );
  return client;
}

/** A harness with the mcp module on, a signed-up owner, a vehicle and one token per scope. */
export async function mcpHarness(enabled: Record<string, boolean> = {}) {
  const h = harness({ mcp: true, ...enabled });
  const { cookie } = await h.signUp();
  const web = (method: string, url: string, body?: object) => h.call(method, url, body, { cookie });
  await web('POST', '/vehicles', { name: 'Civic', kind: 'car' });
  const make = async (scope: 'read' | 'write') =>
    (await web('POST', '/mcp/tokens', { name: scope, scope })).json() as {
      id: number;
      token: string;
    };
  return { h, cookie, web, read: await make('read'), write: await make('write') };
}

/** The structured result of a tool call. */
export const resultOf = (r: unknown) =>
  (r as { structuredContent: { result: unknown } }).structuredContent.result;
