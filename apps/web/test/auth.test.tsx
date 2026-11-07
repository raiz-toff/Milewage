// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp, settingsFixture, pick } from './support/kit';

afterEach(cleanup);

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(new RegExp(label)), { target: { value } });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('login', () => {
  const signedOut = (login: () => { status?: number; body?: unknown }) => {
    let signedIn = false;
    return renderApp({
      'GET /setup/status': () => ({ body: { state: 'ready' } }),
      'GET /settings': () =>
        signedIn ? { body: settingsFixture() } : { status: 401, body: { code: 'auth_required' } },
      'POST /auth/login': () => {
        const r = login();
        if (!r.status || r.status < 400) signedIn = true;
        return r;
      },
    });
  };

  it('signs in and shows the app', async () => {
    const { calls } = signedOut(() => ({ status: 204 }));
    await screen.findByRole('heading', { name: 'Sign in' });
    type('Username', 'rider');
    type('Password', 'correct horse');
    click('Sign in');
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(calls.find((c) => c.path === '/auth/login')?.body).toEqual({
      username: 'rider',
      password: 'correct horse',
    });
  });

  it('shows the wrong-password message and stays on the form', async () => {
    signedOut(() => ({
      status: 401,
      body: { code: 'invalid_credentials', detail: 'Wrong username or password.' },
    }));
    await screen.findByRole('heading', { name: 'Sign in' });
    type('Username', 'rider');
    type('Password', 'nope');
    click('Sign in');
    expect((await screen.findByRole('alert')).textContent).toBe('Wrong username or password.');
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
  });

  it('says how long to wait when the server rate-limits sign-in', async () => {
    signedOut(() => ({
      status: 429,
      headers: { 'Retry-After': '90' },
      body: { code: 'rate_limited', detail: 'Too many failed sign-ins.' },
    }));
    await screen.findByRole('heading', { name: 'Sign in' });
    click('Sign in');
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Too many failed sign-ins. Try again in 90 s.',
    );
  });
});

describe('setup wizard', () => {
  const server = (setup: () => { status?: number; body?: unknown }) => {
    let confirmed = false;
    return renderApp({
      'GET /setup/status': () => ({ body: { state: confirmed ? 'ready' : 'needs_setup' } }),
      'GET /settings': () => ({ body: settingsFixture() }),
      'POST /setup': setup,
      'POST /setup/confirm': ({ body }) => {
        if ((body as { last6: string }).last6 !== 'abc123') {
          return {
            status: 422,
            body: {
              code: 'validation_failed',
              errors: [{ path: '/last6', message: 'does not match the last 6 characters' }],
            },
          };
        }
        confirmed = true;
        return { body: { state: 'ready' } };
      },
    });
  };

  it('creates the owner with country defaults, shows the key once, confirms the tail', async () => {
    const { calls } = server(() => ({
      status: 201,
      body: { recovery_key: 'AGE-SECRET-KEY-1XYZabc123', state: 'needs_confirmation' },
    }));
    await screen.findByRole('heading', { name: 'Set up MileWage' });
    type('Username', 'rider');
    type('Password', 'a long enough password');
    pick(screen.getByLabelText('Country'), 'US');
    click('Create account');
    expect((await screen.findByTestId('recovery-key')).textContent).toBe(
      'AGE-SECRET-KEY-1XYZabc123',
    );
    const sent = calls.find((c) => c.path === '/setup')?.body as Record<string, string>;
    expect(sent).toMatchObject({ country: 'US', currency: 'USD', distance_unit: 'mi' });

    // The button stays disabled until six characters are typed; a wrong tail is reported.
    expect((screen.getByRole('button', { name: 'I saved it' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    type('Last 6', 'zzzzzz');
    click('I saved it');
    expect((await screen.findByRole('alert')).textContent).toContain('/last6');
    type('Last 6', 'abc123');
    click('I saved it');
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeTruthy();
  });

  it('shows the server error and keeps the typed values when setup is refused', async () => {
    server(() => ({
      status: 422,
      body: { code: 'validation_failed', errors: [{ path: '/password', message: 'is too short' }] },
    }));
    await screen.findByRole('heading', { name: 'Set up MileWage' });
    type('Username', 'rider');
    type('Password', 'short');
    click('Create account');
    expect((await screen.findByRole('alert')).textContent).toBe('/password: is too short');
    expect((screen.getByLabelText(/Username/) as HTMLInputElement).value).toBe('rider');
  });

  it('after a reload before confirming, asks for the saved key tail without showing a key', async () => {
    renderApp({
      'GET /setup/status': () => ({ body: { state: 'needs_confirmation' } }),
      'GET /settings': () => ({ status: 403, body: { code: 'setup_incomplete' } }),
    });
    await waitFor(() => expect(screen.getByText(/cannot be shown again/)).toBeTruthy());
    expect(screen.queryByTestId('recovery-key')).toBeNull();
  });
});
