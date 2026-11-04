// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api/client';
import { renderApp, settingsFixture, signedIn } from './support/kit';

afterEach(cleanup);

describe('auth shell', () => {
  it('shows the signed-in shell with navigation once settings load', async () => {
    renderApp(signedIn());
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Shifts' })).toBeTruthy();
  });

  it('a 401 on settings means signed out', async () => {
    renderApp({
      'GET /setup/status': () => ({ body: { state: 'ready' } }),
      'GET /settings': () => ({ status: 401, body: { code: 'auth_required' } }),
    });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
  });

  it('a server with no owner asks for setup before anything else', async () => {
    const { calls } = renderApp({
      'GET /setup/status': () => ({ body: { state: 'needs_setup' } }),
    });
    expect(await screen.findByRole('heading', { name: 'Set up MileWage' })).toBeTruthy();
    expect(calls.map((c) => c.path)).toEqual(['/setup/status']);
  });

  it('an unreachable server is reported, not left loading', async () => {
    renderApp({ 'GET /setup/status': () => ({ status: 503, body: { code: 'restoring' } }) });
    await waitFor(() => expect(screen.getByText(/could not be reached/)).toBeTruthy());
  });
});

describe('typed client', () => {
  it('rejects unknown paths and wrong body shapes at compile time', () => {
    const api = createApi(() => Promise.reject(new Error('never called')));
    // The typecheck run is the test: these lines must be errors, so the directives must be used.
    // @ts-expect-error not a path in the OpenAPI document
    void api.GET('/no-such-path').catch(() => undefined);
    // @ts-expect-error distance_unit is km or mi
    void api.PATCH('/settings', { body: { distance_unit: 'furlong' } }).catch(() => undefined);
    expect(settingsFixture().modules.exporters).toContain('csv');
  });
});
