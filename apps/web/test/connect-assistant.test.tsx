// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { signInText } from '../src/pages/Assistants';
import { pick, renderApp, settingsFixture, signedIn } from './support/kit';

afterEach(cleanup);

const ASK = {
  client_id: 'c1',
  redirect_uri: 'http://localhost:5555/callback',
  response_type: 'code',
  code_challenge: 'x'.repeat(43),
  code_challenge_method: 'S256',
  state: 'st8',
};
const url = `/oauth/authorize?${new URLSearchParams(ASK).toString()}`;

function server(over: { mcp?: boolean; bad?: boolean } = {}) {
  return renderApp(
    {
      ...signedIn(settingsFixture({ modules: { mcp: over.mcp ?? true } })),
      'GET /oauth/authorize': () =>
        over.bad
          ? {
              status: 422,
              body: {
                code: 'validation_failed',
                detail:
                  'MileWage does not know this assistant. Start connecting again from the assistant.',
              },
            }
          : {
              body: { client_name: 'Claude Code', redirect_uri: ASK.redirect_uri, scope: 'write' },
            },
      'POST /oauth/authorize': ({ body }: { body: { decision: string } }) => ({
        body: {
          redirect_to: `${ASK.redirect_uri}?${body.decision === 'allow' ? 'code=abc' : 'error=access_denied'}`,
        },
      }),
    } as never,
    url,
  );
}

describe('connect an assistant by signing in', () => {
  it('says who is asking and where the browser goes back to, then sends the choice', async () => {
    const s = server();
    const card = await screen.findByRole('region', { name: 'Assistant asking' });
    expect(card.textContent).toContain('Claude Code wants to reach your MileWage records.');
    expect(within(card).getByText('localhost:5555')).toBeTruthy();
    expect(s.calls.find((c) => c.method === 'GET' && c.path === '/oauth/authorize')?.query).toBe(
      `?${new URLSearchParams(ASK).toString()}`,
    );
    pick('Access', 'read'); // the assistant asked for write; the driver gives less
    fireEvent.click(within(card).getByRole('button', { name: 'Allow' }));
    await screen.findByRole('region', { name: 'Done' });
    expect(s.calls.find((c) => c.method === 'POST')?.body).toEqual({
      ...ASK,
      decision: 'allow',
      access: 'read',
    });
  });

  it('can say no', async () => {
    const s = server();
    const card = await screen.findByRole('region', { name: 'Assistant asking' });
    fireEvent.click(within(card).getByRole('button', { name: 'Do not allow' }));
    await screen.findByRole('region', { name: 'Done' });
    expect(s.calls.find((c) => c.method === 'POST')?.body).toMatchObject({ decision: 'deny' });
  });

  it('shows the problem and no buttons when the request is wrong', async () => {
    server({ bad: true });
    const card = await screen.findByRole('region', { name: 'Cannot connect' });
    expect(card.textContent).toContain('MileWage does not know this assistant.');
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
  });

  it('is not there with the mcp module off', async () => {
    server({ mcp: false });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('region', { name: 'Assistant asking' })).toBeNull();
  });

  it('Settings gives the address and the Claude Code command without a code', () => {
    expect(signInText('https://box.tail1.ts.net')).toEqual({
      url: 'https://box.tail1.ts.net/api/v1/mcp',
      code: 'claude mcp add --transport http milewage https://box.tail1.ts.net/api/v1/mcp',
    });
  });
});
