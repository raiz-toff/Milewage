// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { apiKey, createQueryClient } from '../src/api/query';
import { PAIR_POLL_MS, usePairingSession } from '../src/pairing/session';
import { SessionProvider } from '../src/session';
import { fakeServer } from './support/kit';
import type { Handler } from './support/kit';

afterEach(cleanup);

const phone = (id: number, name: string) => ({
  id,
  name,
  platform: 'android',
  created_at: 1,
  last_seen_at: null,
  revoked_at: null,
});

const code = (n: number, expiresAt: number, base = 'https://host', source = 'request') => ({
  token: `mwp_${n}`,
  expires_at: expiresAt,
  qr_payload: `milewage://pair?v=1&t=mwp_${n}`,
  pair_url: `${base}/pair#v=1&t=mwp_${n}`,
  base_url: base,
  base_url_source: source,
  home_url: null,
  away_url: base,
});

/**
 * The pairing session at its interface, against the fake server at the fetch seam. `life` is how
 * long each new code is valid; `devices` is what `GET /devices` answers at the time.
 */
function mount({
  start = true,
  life = 10 * 60_000,
  devices = () => [] as object[],
  known,
  extra = {},
}: {
  start?: boolean;
  life?: number;
  devices?: () => object[];
  known?: object[];
  extra?: Record<string, Handler>;
}) {
  let made = 0;
  const server = fakeServer({
    'GET /devices': () => ({ body: devices() }),
    'POST /pairing-tokens': ({ body }) => {
      const base = (body as { base_url?: string } | undefined)?.base_url;
      made += 1;
      return {
        status: 201,
        body: base ? code(made, Date.now() + life, base, 'driver') : code(made, Date.now() + life),
      };
    },
    ...extra,
  });
  const client = createQueryClient({ retry: false });
  // The device list a screen already showed when the session began (the Devices page).
  if (known) client.setQueryData(apiKey('/devices'), known);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <SessionProvider api={server.api}>{children}</SessionProvider>
    </QueryClientProvider>
  );
  const view = renderHook(() => usePairingSession({ start }), { wrapper });
  const posts = () =>
    server.calls.filter((c) => c.method === 'POST' && c.path === '/pairing-tokens');
  return { ...view, server, posts };
}

describe('usePairingSession: one phone pairing', () => {
  it('asks for nothing until it starts; renew() makes the first code', async () => {
    const { result, posts, server } = mount({ start: false });
    expect(result.current.state).toBe('idle');
    expect(result.current.code).toBeNull();
    expect(posts()).toHaveLength(0);
    expect(server.calls.some((c) => c.path === '/devices')).toBe(false);
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.renew();
    });
    expect(ok).toBe(true);
    expect(result.current.code?.token).toBe('mwp_1');
    expect(result.current.state).toBe('waiting');
  });

  it('mints a code when it starts and waits; an answer without a new phone keeps it waiting', async () => {
    const { result, posts, server } = mount({ devices: () => [] });
    expect(result.current.state).toBe('minting');
    await waitFor(() => expect(result.current.state).toBe('waiting'));
    expect(result.current.code?.pair_url).toBe('https://host/pair#v=1&t=mwp_1');
    expect(posts().map((c) => c.body ?? null)).toEqual([null]);
    await waitFor(() =>
      expect(server.calls.filter((c) => c.path === '/devices').length).toBeGreaterThan(0),
    );
    expect(result.current.state).toBe('waiting');
  });

  it('is paired when a phone appears that was not in the list when the code was made', async () => {
    const old = phone(1, 'Old Pixel');
    let list: object[] = [old];
    const { result } = mount({ devices: () => list, known: [old] });
    await waitFor(() => expect(result.current.state).toBe('waiting'));
    // The phone scans the code: the server lists it on the next poll.
    list = [old, phone(2, 'Galaxy S24')];
    await waitFor(() => expect(result.current.state).toBe('paired'), {
      timeout: PAIR_POLL_MS * 4,
    });
  });

  it('a revoked phone appearing does not count', async () => {
    const { result, server } = mount({
      devices: () => [{ ...phone(3, 'Lost'), revoked_at: 5 }],
    });
    await waitFor(() =>
      expect(server.calls.filter((c) => c.path === '/devices').length).toBeGreaterThan(1),
    );
    expect(result.current.state).toBe('waiting');
  });

  it('replaces a code that runs out with a new one for the same address', async () => {
    const { result, posts } = mount({ start: false, life: 300 });
    await act(async () => {
      await result.current.renew('https://mw.tail9.ts.net');
    });
    expect(result.current.code?.token).toBe('mwp_1');
    await waitFor(() => expect(result.current.code?.token).toBe('mwp_2'));
    expect(posts()[1]?.body).toEqual({ base_url: 'https://mw.tail9.ts.net' });
    expect(result.current.state).toBe('waiting');
  });

  it('says expired, and asks for no more, when a code arrives already out of date', async () => {
    const { result, posts } = mount({ life: -1000 });
    await waitFor(() => expect(result.current.state).toBe('expired'));
    expect(result.current.code?.token).toBe('mwp_1');
    await new Promise((r) => setTimeout(r, 200));
    expect(posts()).toHaveLength(1);
  });

  it('renew(address) replaces the code; a refused address keeps the old code and says why', async () => {
    const refuse: Handler = ({ body }) =>
      (body as { base_url?: string } | undefined)?.base_url === 'https://nope'
        ? {
            status: 422,
            body: { code: 'validation_failed', detail: 'The address must start with https://' },
          }
        : { status: 201, body: code(9, Date.now() + 60_000, 'https://box.ts.net', 'driver') };
    const { result } = mount({ extra: { 'POST /pairing-tokens': refuse } });
    await waitFor(() => expect(result.current.state).toBe('waiting'));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.renew(' https://nope ');
    });
    expect(ok).toBe(false);
    await waitFor(() => expect(result.current.error).toBe('The address must start with https://'));
    expect(result.current.code?.base_url).toBe('https://box.ts.net');
    expect(result.current.state).toBe('waiting');
  });

  it('with no code because asking failed, the state is error and the reason is the server sentence', async () => {
    const { result } = mount({
      extra: {
        'POST /pairing-tokens': () => ({
          status: 503,
          body: { code: 'unavailable', detail: 'The server is busy. Try again in a minute.' },
        }),
      },
    });
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.code).toBeNull();
    expect(result.current.error).toBe('The server is busy. Try again in a minute.');
  });
});
