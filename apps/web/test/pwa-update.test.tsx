// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import { UpdatePrompt } from '../src/pwa/UpdatePrompt';
import { UPDATE_CHECK_MS, resetUpdates, startUpdates } from '../src/pwa/update';
import { renderApp, signedIn } from './support/kit';

// Plan 27 sections 4.3 and 4.5: the update offer and the offline notice.

function fakeRegister() {
  const update = vi.fn(async () => {});
  let options: RegisterSWOptions = {};
  const register = vi.fn((o: RegisterSWOptions) => {
    options = o;
    return update;
  });
  return { register, update, options: () => options };
}

const setServiceWorker = (on: boolean) => {
  if (on) Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });
  else delete (navigator as { serviceWorker?: unknown }).serviceWorker;
};

beforeEach(() => setServiceWorker(true));
afterEach(() => {
  cleanup();
  resetUpdates();
  setServiceWorker(false);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('service worker registration', () => {
  it('registers nothing where the browser has no service workers (plain http on the LAN)', () => {
    setServiceWorker(false);
    const sw = fakeRegister();
    startUpdates(sw.register);
    expect(sw.register).not.toHaveBeenCalled();
  });

  it('registers at start-up and checks for a new version every hour while online', () => {
    vi.useFakeTimers();
    const sw = fakeRegister();
    startUpdates(sw.register);
    expect(sw.options().immediate).toBe(true);
    const registration = { update: vi.fn(async () => {}), installing: null };
    sw.options().onRegisteredSW?.('/sw.js', registration as unknown as ServiceWorkerRegistration);
    vi.advanceTimersByTime(UPDATE_CHECK_MS - 1);
    expect(registration.update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(registration.update).toHaveBeenCalledTimes(1);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    expect(registration.update).toHaveBeenCalledTimes(1);
  });
});

describe('"A new version of MileWage is ready"', () => {
  it('shows nothing until a new version waits', () => {
    startUpdates(fakeRegister().register);
    render(<UpdatePrompt />);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('Reload hands over to the new version (skip waiting, then the page reloads)', () => {
    const sw = fakeRegister();
    startUpdates(sw.register);
    render(<UpdatePrompt />);
    act(() => sw.options().onNeedRefresh?.());
    expect(screen.getByRole('status').textContent).toContain('A new version of MileWage is ready.');
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(sw.update).toHaveBeenCalledWith(true);
    expect(screen.getByRole('button', { name: 'Reloading' })).toHaveProperty('disabled', true);
  });

  it('Later hides it without updating', () => {
    const sw = fakeRegister();
    startUpdates(sw.register);
    render(<UpdatePrompt />);
    act(() => sw.options().onNeedRefresh?.());
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText(/new version/)).toBeNull();
    expect(sw.update).not.toHaveBeenCalled();
  });
});

describe('server not reachable', () => {
  it('says the browser is offline, and Try again opens the app once the server answers', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    let up = false;
    const routes = signedIn();
    renderApp({
      ...routes,
      'GET /setup/status': (req) =>
        up ? routes['GET /setup/status']!(req) : { status: 503, body: { code: 'restoring' } },
    });
    expect(await screen.findByRole('heading', { name: 'You are offline' })).toBeTruthy();
    up = true;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeTruthy();
  });

  it('tries again by itself when the connection comes back', async () => {
    let up = false;
    const routes = signedIn();
    renderApp({
      ...routes,
      'GET /setup/status': (req) =>
        up ? routes['GET /setup/status']!(req) : { status: 503, body: { code: 'restoring' } },
    });
    expect(await screen.findByText('The server could not be reached.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'MileWage is not answering' })).toBeTruthy();
    up = true;
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy());
  });
});
