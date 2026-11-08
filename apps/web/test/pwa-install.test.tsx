// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallCard, InstallSection } from '../src/pwa/Install';
import {
  browserKind,
  captureInstallPrompt,
  cardShows,
  installState,
  promptInstall,
  resetInstall,
} from '../src/pwa/install';
import { renderApp, signedIn } from './support/kit';

// Plan 27 section 4.4: the install prompt.

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  windowsFirefox:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0',
};

let standalone = false;
function browser(ua: string, { secure = true, touch = 0 } = {}) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
  // jsdom has no maxTouchPoints.
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touch, configurable: true });
  Object.defineProperty(window, 'isSecureContext', { value: secure, configurable: true });
}

/** Chromium's install event, with a dialog that answers `outcome`. */
function offerInstall(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  const prompt = vi.fn(async () => {});
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });
  act(() => {
    window.dispatchEvent(event);
  });
  return { event, prompt };
}

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({
      matches: standalone && query === '(display-mode: standalone)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList;
  captureInstallPrompt();
});
beforeEach(() => {
  standalone = false;
  localStorage.clear();
  browser(UA.windowsEdge);
});
afterEach(() => {
  cleanup();
  resetInstall();
  vi.restoreAllMocks();
});

describe('which way this browser installs', () => {
  it('reads the browser from its user agent', () => {
    expect(browserKind(UA.iphone)).toBe('ios');
    expect(browserKind(UA.ipad, 5)).toBe('ios'); // iPadOS shows the desktop site
    expect(browserKind(UA.macSafari, 0)).toBe('safari-mac');
    expect(browserKind(UA.androidFirefox)).toBe('firefox-android');
    for (const ua of [UA.macChrome, UA.androidChrome, UA.windowsEdge, UA.windowsFirefox])
      expect(browserKind(ua)).toBe('other');
  });

  it('Chrome and Edge: nothing until the browser offers, then its dialog', async () => {
    expect(installState()).toBe('unsupported');
    const { event, prompt } = offerInstall();
    expect(event.defaultPrevented).toBe(true); // no mini-infobar of its own
    expect(installState()).toBe('prompt');
    expect(await promptInstall()).toBe('accepted');
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(installState()).toBe('installed');
  });

  it('a dismissed dialog cannot be opened again with the same event', async () => {
    offerInstall('dismissed');
    expect(await promptInstall()).toBe('dismissed');
    expect(installState()).toBe('unsupported');
    expect(await promptInstall()).toBe('unavailable');
  });

  it('installed from the browser menu: appinstalled', () => {
    offerInstall();
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(installState()).toBe('installed');
  });

  it('running as the installed app', () => {
    standalone = true;
    offerInstall();
    expect(installState()).toBe('installed');
  });

  it('plain http: nothing to install, except Safari which adds any site', () => {
    browser(UA.androidChrome, { secure: false });
    expect(installState()).toBe('insecure');
    browser(UA.iphone, { secure: false });
    expect(installState()).toBe('ios');
  });

  it('the card is for one click or one short step, and never after Not now', () => {
    for (const s of ['prompt', 'ios', 'safari-mac'] as const) {
      expect(cardShows(s, false)).toBe(true);
      expect(cardShows(s, true)).toBe(false);
    }
    for (const s of ['installed', 'insecure', 'unsupported', 'firefox-android'] as const)
      expect(cardShows(s, false)).toBe(false);
  });
});

describe('Install MileWage card', () => {
  it('appears once the browser offers, and Install opens its dialog', () => {
    render(<InstallCard />);
    expect(screen.queryByRole('region', { name: 'Install MileWage' })).toBeNull();
    const { prompt } = offerInstall();
    expect(screen.getByRole('region', { name: 'Install MileWage' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(prompt).toHaveBeenCalled();
  });

  it('Not now hides it for good', () => {
    offerInstall();
    render(<InstallCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('region', { name: 'Install MileWage' })).toBeNull();
    cleanup();
    render(<InstallCard />);
    expect(screen.queryByRole('region', { name: 'Install MileWage' })).toBeNull();
    expect(localStorage.getItem('mw-install-dismissed')).not.toBeNull();
  });

  it('on an iPhone it gives the Share steps', () => {
    browser(UA.iphone);
    render(<InstallCard />);
    expect(screen.getByText('Tap Share, then Add to Home Screen.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
  });

  it('sits in the sidebar of the app', async () => {
    renderApp(signedIn());
    await screen.findByRole('navigation', { name: 'Main' });
    offerInstall();
    expect(screen.getByRole('region', { name: 'Install MileWage' })).toBeTruthy();
  });
});

describe('Settings › App on this device', () => {
  it('offers Install where the browser can, and says so once installed', async () => {
    render(<InstallSection />);
    expect(screen.getByText(/has not offered to install MileWage/)).toBeTruthy();
    offerInstall();
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(await screen.findByText(/MileWage is installed on this device/)).toBeTruthy();
  });

  it('on plain http it says to open the https address', () => {
    browser(UA.androidChrome, { secure: false });
    render(<InstallSection />);
    expect(screen.getByText(/Open MileWage at its https:\/\/ address/)).toBeTruthy();
  });

  it('is a section of Settings', async () => {
    renderApp(signedIn(), '/settings/app');
    expect(
      await screen.findByRole('heading', { level: 2, name: 'App on this device' }),
    ).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Install' })).toBeTruthy();
  });
});
