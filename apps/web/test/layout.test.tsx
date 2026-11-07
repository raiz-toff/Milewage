// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp, settingsFixture, signedIn } from './support/kit';

afterEach(cleanup);

/*
 * jsdom does no layout, so these tests hold the class contract that keeps the page to one
 * scroll region at every width (the screenshots in progress.md W3a are the visual check).
 */
const open = (url: string) =>
  renderApp({ ...signedIn(), 'GET /settings': () => ({ body: settingsFixture() }) }, url);

describe('page layout and scrolling', () => {
  it('lets the page area shrink beside the sidebar, so a wide table scrolls in its box, not the page', async () => {
    open('/dashboard');
    await screen.findByRole('navigation', { name: 'Main' });
    const inset = document.querySelector('[data-slot="sidebar-inset"]');
    // A flex item does not shrink below its content without min-width 0.
    expect(inset?.className.split(' ')).toContain('min-w-0');
  });

  it('shows the sidebar scroll bar when the menu is taller than the window, also when folded to icons', async () => {
    open('/dashboard');
    await screen.findByRole('navigation', { name: 'Main' });
    const classes = document.querySelector('[data-slot="sidebar-content"]')!.className.split(' ');
    expect(classes).toContain('overflow-auto');
    expect(classes).not.toContain('no-scrollbar');
    expect(classes).not.toContain('group-data-[collapsible=icon]:overflow-hidden');
  });

  it('gives native scroll bars and controls the theme colours', () => {
    const css = readFileSync(join(import.meta.dirname, '../src/index.css'), 'utf8');
    expect(css).toMatch(/:root\s*{[^}]*color-scheme:\s*light;/);
    expect(css).toMatch(/\.dark\s*{[^}]*color-scheme:\s*dark;/);
  });

  it('never scrolls the settings sections sideways: a list where there is room, else one menu', async () => {
    open('/settings/tracking');
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' });
    expect(nav.className).not.toMatch(/overflow-x-auto/);
    // The width that decides is the settings area's own (a container query), not the window's.
    expect(nav.closest('.\\@container')).toBeTruthy();
    const list = within(nav).getAllByRole('list')[0]!.closest('.hidden');
    expect(list?.className).toMatch(/@2xl:(flex|block)/);

    const button = within(nav).getByRole('button', { name: /Section: Tracking/ });
    expect(button.className).toMatch(/@2xl:hidden/);
    fireEvent.keyDown(button, { key: 'Enter' });
    const item = screen.getByRole('menuitem', { name: 'Units and format' });
    expect(item.getAttribute('href')).toBe('/settings/units');
    expect(
      screen.getByRole('menuitem', { name: 'Tracking and privacy' }).getAttribute('aria-current'),
    ).toBe('page');
    fireEvent.click(item);
    expect(await screen.findByLabelText('Distance unit')).toBeTruthy();
    expect(within(nav).getByRole('button', { name: /Section: Units and format/ })).toBeTruthy();
  });
});
