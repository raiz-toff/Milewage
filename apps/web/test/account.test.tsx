// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp, signedIn } from './support/kit';

afterEach(cleanup);

function open(status = 204) {
  return renderApp(
    {
      ...signedIn(),
      'POST /auth/password': () => ({
        status,
        body: status === 204 ? undefined : { code: 'unauthorized' },
      }),
    } as never,
    '/settings/account',
  );
}

function fill(current: string, next: string, again: string) {
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('New password', { exact: true }), {
    target: { value: next },
  });
  fireEvent.change(screen.getByLabelText('New password again'), { target: { value: again } });
}

describe('change password', () => {
  it('sends the current and new password and confirms', async () => {
    const s = open();
    await screen.findByLabelText('Current password');
    fill('old-password-1', 'a-new-password', 'a-new-password');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('status')).toBeTruthy();
    const post = s.calls.find((c) => c.path === '/auth/password');
    expect(post?.body).toEqual({
      current_password: 'old-password-1',
      new_password: 'a-new-password',
    });
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('');
  });

  it('refuses a short or mismatched password without calling the server', async () => {
    const s = open();
    await screen.findByLabelText('Current password');
    fill('old-password-1', 'short', 'short');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/at least 10/);
    fill('old-password-1', 'a-new-password', 'a-different-one');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/differ/);
    expect(s.calls.some((c) => c.path === '/auth/password')).toBe(false);
  });

  it('shows the server error when the current password is wrong', async () => {
    open(401);
    await screen.findByLabelText('Current password');
    fill('wrong-password', 'a-new-password', 'a-new-password');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
