// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppPage } from '../src/pages/AppPage';
import { PrivacyPage } from '../src/pages/PrivacyPage';
import { basemapHost } from '../src/map/style';
import { publicPage } from '../src/publicPages';
import { spaPaths } from '../src/screens';
import { Card } from '../src/ui/form';
import { renderApp, signedIn } from './support/kit';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The public privacy page every instance serves at /privacy (no sign-in). */
describe('privacy page', () => {
  it('opens at /privacy without a session and asks the server nothing', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    history.replaceState(null, '', '/privacy');
    render(<>{publicPage('/privacy')}</>);
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy' })).toBeTruthy();
    expect(document.title).toBe('Privacy · MileWage');
    expect(fetch).not.toHaveBeenCalled();
    expect(spaPaths()).toContain('/privacy');
    expect(publicPage('/dashboard')).toBeNull();
  });

  it('covers the phone, the server, others, diagnostics, deleting and who to ask', () => {
    render(<PrivacyPage />);
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual([
      'On the phone',
      'On this server',
      'Who else sees something, and when',
      'Diagnostics',
      'Deleting your data',
      'Questions',
    ]);
    const phone = screen.getByRole('region', { name: 'On the phone' });
    expect(phone.textContent).toMatch(/only while a shift is running/);
    expect(phone.textContent).toMatch(/then 14 days\s+more/);
    const del = screen.getByRole('region', { name: 'Deleting your data' });
    expect(within(del).getByText('docker compose -f infra/docker/docker-compose.yml down -v'));
    expect(screen.getByText(/Road snapping\./).parentElement!.textContent).toMatch(
      /Not in this version/,
    );
    expect(document.body.textContent).not.toMatch(/—/); // no em-dashes
  });

  it('names the map service this build uses, or none', () => {
    render(<PrivacyPage />);
    expect(screen.getByText('Maps (OpenFreeMap).')).toBeTruthy();
    cleanup();
    render(<PrivacyPage mapStyleUrl="https://maps.example.net/style.json" />);
    expect(screen.getByText('Maps (maps.example.net).')).toBeTruthy();
    cleanup();
    render(<PrivacyPage mapStyleUrl="none" />);
    expect(screen.getByText(/built without an outside map service/)).toBeTruthy();
    expect(basemapHost(undefined)).toBe('tiles.openfreemap.org');
    expect(basemapHost('/tiles/style.json')).toBeNull();
  });
});

describe('links to the privacy page', () => {
  it('under every sign-in and setup card', () => {
    render(
      <Card title="Sign in">
        <p>form</p>
      </Card>,
    );
    const link = screen.getByRole('link', { name: 'Privacy' });
    // A full page load: the page is outside the router and the session.
    expect(link.getAttribute('href')).toBe('/privacy');
  });

  it('in the account menu at the foot of the sidebar', async () => {
    renderApp(signedIn());
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Account' }), { key: 'Enter' });
    const item = await screen.findByRole('menuitem', { name: 'Privacy' });
    expect(item.getAttribute('href')).toBe('/privacy');
  });

  it('in Settings, Tracking and privacy', async () => {
    renderApp(signedIn(), '/settings/tracking');
    await screen.findByRole('heading', { level: 2, name: 'Tracking and privacy' });
    const link = await screen.findByRole('link', { name: 'Privacy' });
    expect(link.getAttribute('href')).toBe('/privacy');
  });

  it('on the app download page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ apk: null, store_url: null })),
    );
    render(<AppPage />);
    expect((await screen.findByRole('link', { name: 'Privacy' })).getAttribute('href')).toBe(
      '/privacy',
    );
  });
});
