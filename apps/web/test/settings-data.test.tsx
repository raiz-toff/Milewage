// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { pick, renderApp, settingsFixture, signedIn } from './support/kit';

afterEach(cleanup);

const open = (url: string, modules = {}) =>
  renderApp({ ...signedIn(settingsFixture({ modules })) }, url);

const sectionNav = () => screen.findByRole('navigation', { name: 'Settings sections' });
const heading = (name: string) => screen.findByRole('heading', { level: 2, name });
const go = async (label: string) =>
  fireEvent.click(within(await sectionNav()).getByRole('link', { name: label }));
const elsewhere = () => within(screen.getByRole('list', { name: 'Elsewhere in MileWage' }));

describe('settings: your data, devices and saving', () => {
  it('leads to backups, exports and devices from the sections they belong to', async () => {
    open('/settings/import');
    // The old Import address opens Your data, with the import card on it.
    expect(await heading('Your data')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Import' })).toBeTruthy();
    expect(
      elsewhere()
        .getByRole('link', { name: /^Backups/ })
        .getAttribute('href'),
    ).toBe('/backups');
    expect(
      elsewhere()
        .getByRole('link', { name: /^Exports/ })
        .getAttribute('href'),
    ).toBe('/exports');
    await go('Account and security');
    await heading('Account and security');
    expect(
      elsewhere()
        .getByRole('link', { name: /^Devices/ })
        .getAttribute('href'),
    ).toBe('/devices');
  });

  it('leaves out what is switched off: import, exports and devices', async () => {
    open('/settings/data', { import: false, devices: false, exporters: [] });
    await heading('Your data');
    expect(screen.queryByRole('region', { name: 'Import' })).toBeNull();
    expect(elsewhere().getByRole('link', { name: /^Backups/ })).toBeTruthy();
    expect(elsewhere().queryByRole('link', { name: /^Exports/ })).toBeNull();
    await go('Account and security');
    await heading('Account and security');
    expect(screen.queryByRole('link', { name: /^Devices/ })).toBeNull();
  });

  it('says how each section saves and which sections hold unsaved changes', async () => {
    open('/settings/units');
    await heading('Units and format');
    expect(screen.getByText(/Saved with the Save button below/)).toBeTruthy();
    pick(await screen.findByLabelText('Distance unit'), 'mi');
    await go('Tracking and privacy');
    fireEvent.change(await screen.findByLabelText('Keep raw GPS points (days)'), {
      target: { value: '30' },
    });
    expect(
      screen.getByText('Unsaved changes: Units and format, Tracking and privacy.'),
    ).toBeTruthy();
    await go('Platforms');
    await heading('Platforms');
    expect(screen.getByText('Each change is saved at once.')).toBeTruthy();
    await go('Account and security');
    await heading('Account and security');
    expect(screen.getByText(/Uses its own button/)).toBeTruthy();
  });
});
