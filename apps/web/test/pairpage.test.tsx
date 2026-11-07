// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PairPage } from '../src/pages/PairPage';
import { spaPaths } from '../src/screens';

const TOKEN = `mwp_${'a'.repeat(43)}`;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The page the pairing QR opens in the phone's own camera app (plan 24 Q1). */
const open = (hash: string, apk: boolean, agent = 'Mozilla/5.0 (Linux; Android 15)') => {
  history.replaceState(null, '', `/pair${hash}`);
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(agent);
  const fetch = vi.fn(async () => new Response(null, { status: apk ? 200 : 404 }));
  vi.stubGlobal('fetch', fetch);
  render(<PairPage />);
  return fetch;
};

describe('pair page', () => {
  it('on the phone: opens the app with this server and the code, and offers the app', async () => {
    const fetch = open(`#v=1&t=${TOKEN}`, true);
    const link = screen.getByRole('link', { name: 'Open in the MileWage app' });
    const base = encodeURIComponent(location.origin);
    expect(link.getAttribute('href')).toBe(`milewage://pair?v=1&u=${base}&t=${TOKEN}`);
    expect(await screen.findByRole('link', { name: 'Get the app' })).toBeTruthy();
    const req = (fetch.mock.calls[0] as unknown as [Request])[0];
    expect([req.method, new URL(req.url).pathname]).toEqual(['HEAD', '/api/v1/app/android.apk']);
  });

  it('no app file: no Get the app; a broken link says what to do', async () => {
    open(`#v=1&t=${TOKEN}`, false);
    expect(screen.getByRole('link', { name: 'Open in the MileWage app' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Get the app' })).toBeNull();
    cleanup();
    open('#v=1', false);
    expect(screen.getByRole('alert').textContent).toMatch(/This link is not complete/);
  });

  it('is served by Caddy as a web page', () => {
    expect(spaPaths()).toContain('/pair');
  });
});
