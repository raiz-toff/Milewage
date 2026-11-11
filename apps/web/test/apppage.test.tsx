// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppPage } from '../src/pages/AppPage';
import { spaPaths } from '../src/screens';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PLAY = 'https://play.google.com/store/apps/details?id=app.milewage.phone';
const APK = { size_bytes: 108_296_623, updated_at: Date.UTC(2026, 10, 7, 18), version: '0.1.0' };

/** The download page Get the app opens on the phone (no sign-in). */
function open(apk: object | null, store_url: string | null) {
  const body = {
    apk,
    store_url,
    page_url: 'https://box.ts.net/app',
    base_url: 'https://box.ts.net',
  };
  const fetch = vi.fn(async () => Response.json(body));
  vi.stubGlobal('fetch', fetch);
  history.replaceState(null, '', '/app');
  render(<AppPage />);
  return fetch;
}

describe('app download page', () => {
  it("the server's own app: download link, size, version, date and how to allow the install", async () => {
    const fetch = open(APK, null);
    const link = await screen.findByRole('link', { name: 'Download MileWage' });
    expect(link.getAttribute('href')).toBe('/api/v1/app/android.apk');
    expect(link.getAttribute('download')).toBe('milewage.apk');
    expect(screen.getByText('Version 0.1.0 · 108 MB · Nov 7, 2026')).toBeTruthy();
    expect(screen.getByText(/turn on Allow from this source/)).toBeTruthy();
    expect(screen.queryByText(/Google Play/)).toBeNull();
    expect(document.title).toBe('Get the app — MileWage');
    const req = (fetch.mock.calls[0] as unknown as [Request])[0];
    expect(new URL(req.url).pathname).toBe('/api/v1/app');
  });

  it('a published app: Google Play first, the direct download second', async () => {
    open(APK, PLAY);
    await screen.findByRole('link', { name: 'Get it on Google Play' });
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual([
      'Get it on Google Play',
      'Download MileWage',
      'Privacy',
    ]);
    expect(links[0]!.getAttribute('href')).toBe(PLAY);
    expect(screen.getByText('Or download it directly:')).toBeTruthy();
  });

  it('only a store link (another store is named plainly); nothing at all says what to do', async () => {
    open(null, 'https://f-droid.org/packages/app.milewage.phone/');
    expect(await screen.findByRole('link', { name: 'Get it from the app store' })).toBeTruthy();
    expect(screen.queryByText(/Allow from this source/)).toBeNull();
    cleanup();
    open(null, null);
    expect((await screen.findByRole('status')).textContent).toMatch(/no app to download yet/);
  });

  it('is served by Caddy as a web page', () => {
    expect(spaPaths()).toContain('/app');
  });
});
