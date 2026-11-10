// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp, settingsFixture } from './support/kit';

afterEach(cleanup);

const KEY = `AGE-SECRET-KEY-1${'Q'.repeat(58)}`;
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** Signed out; the reset answers with `reset()` and signs in when it succeeds. */
function signedOut(reset: () => { status?: number; body?: unknown }) {
  let signedIn = false;
  return renderApp({
    'GET /setup/status': () => ({ body: { state: 'ready' } }),
    'GET /settings': () =>
      signedIn ? { body: settingsFixture() } : { status: 401, body: { code: 'auth_required' } },
    'POST /auth/reset-password': () => {
      const r = reset();
      if (!r.status || r.status < 400) signedIn = true;
      return r;
    },
  });
}

describe('forgot password, from the sign-in page', () => {
  it('takes the recovery key and a new password, then signs in', async () => {
    const { calls } = signedOut(() => ({ status: 204 }));
    fireEvent.click(await screen.findByRole('button', { name: 'Forgot your password?' }));
    await screen.findByRole('heading', { name: 'Choose a new password' });
    const submit = screen.getByRole('button', { name: 'Set new password' });
    type('Recovery key', ` ${KEY} `);
    type('New password', 'short');
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    type('New password', 'a brand new secret');
    fireEvent.click(submit);
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(calls.find((c) => c.path === '/auth/reset-password')?.body).toEqual({
      recovery_key: KEY,
      new_password: 'a brand new secret',
    });
  });

  it('says when the key is wrong, offers the command for a lost key, and goes back', async () => {
    signedOut(() => ({
      status: 401,
      body: {
        code: 'invalid_credentials',
        detail: "That is not this server's recovery key. Check it against the copy you saved.",
      },
    }));
    fireEvent.click(await screen.findByRole('button', { name: 'Forgot your password?' }));
    expect(screen.getByText(/milewage-cli reset-password/)).toBeTruthy();
    type('Recovery key', KEY);
    type('New password', 'a brand new secret');
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /not this server's recovery key/,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
  });
});
