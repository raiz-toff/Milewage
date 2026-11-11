// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp, settingsFixture, signedIn } from './support/kit';

afterEach(cleanup);

const open = (url: string, modules = {}) =>
  renderApp({ ...signedIn(settingsFixture({ modules })) }, url);

const sectionNav = () => screen.findByRole('navigation', { name: 'Settings sections' });
const links = async () =>
  within(await sectionNav())
    .getAllByRole('link')
    .map((a) => a.textContent);
const heading = (name: string) => screen.findByRole('heading', { level: 2, name });
const go = async (label: string) =>
  fireEvent.click(within(await sectionNav()).getByRole('link', { name: label }));

describe('settings structure', () => {
  it('groups the sections in order, one address each, and keeps the old address', async () => {
    open('/settings');
    expect(await heading('Profile and region')).toBeTruthy();
    expect(await links()).toEqual([
      'Profile and region',
      'Mileage rate',
      'Units and format',
      'App on this device',
      'Help pages',
      'Platforms',
      'Tracking and privacy',
      'Your data',
      'Account and security',
      'Server modules',
    ]);
    const nav = await sectionNav();
    for (const group of ['Preferences', 'Work and tracking', 'Data and account'])
      expect(within(nav).getByRole('list', { name: group })).toBeTruthy();
    cleanup();

    open('/settings/general');
    expect(await heading('Profile and region')).toBeTruthy();
    expect(screen.getByLabelText('Name')).toBeTruthy();
  });

  it('heads each section with its name and what it is for', async () => {
    open('/settings/tracking');
    expect(await heading('Tracking and privacy')).toBeTruthy();
    expect(screen.getByText(/how long it keeps it/)).toBeTruthy();
    await go('Server modules');
    expect(await heading('Server modules')).toBeTruthy();
    expect(screen.getByText(/read only here/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Modules' })).toBeTruthy();
  });

  it('hides what is switched off on this server, in the list and by address', async () => {
    open('/settings/platforms', { platforms: false });
    expect(await heading('Profile and region')).toBeTruthy();
    expect(await links()).toEqual([
      'Profile and region',
      'Mileage rate',
      'Units and format',
      'App on this device',
      'Help pages',
      'Tracking and privacy',
      'Your data',
      'Account and security',
      'Server modules',
    ]);
  });
});
