// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { connectText } from '../src/pages/Assistants';
import { menu, pick, renderApp, settingsFixture, signedIn } from './support/kit';

afterEach(cleanup);

const TOKEN = `mwa_${'a'.repeat(43)}`;
const token = (over: object = {}) => ({
  id: 1,
  name: 'Laptop',
  scope: 'read',
  created_at: 1_700_000_000_000,
  expires_at: null,
  last_used_at: null,
  revoked_at: null,
  kind: 'code',
  ...over,
});

function server(mcp = true) {
  let tokens: Record<string, unknown>[] = [token()];
  const table = {
    ...signedIn(settingsFixture({ modules: { mcp } })),
    'GET /mcp/tokens': () => ({ body: tokens }),
    'GET /mcp/audit': () => ({
      body: [
        {
          id: 3,
          at: 1_700_000_000_000,
          tool: 'add_expense',
          outcome: 'ok',
          target: 'expense:42',
          token_id: 1,
          token_name: 'Laptop',
        },
      ],
    }),
    'POST /mcp/tokens': ({ body }: { body: { name: string; scope: string } }) => {
      const made = token({ id: 2, name: body.name, scope: body.scope });
      tokens = [made, ...tokens];
      return { status: 201, body: { ...made, token: TOKEN } };
    },
    'POST /mcp/tokens/1/replace': () => ({ body: { ...token(), token: TOKEN } }),
    'DELETE /mcp/tokens/1': () => {
      tokens = tokens.map((t) => (t.id === 1 ? { ...t, revoked_at: 1_700_000_900_000 } : t));
      return { status: 204 };
    },
  };
  return renderApp(table as never, '/settings/assistants');
}

describe('settings: AI assistants (plan 26)', () => {
  it('is not offered while the mcp module is off', async () => {
    server(false);
    await screen.findByRole('heading', { name: 'Profile and region' });
    expect(screen.queryByRole('link', { name: 'AI assistants' })).toBeNull();
  });

  it('makes a token, shows it once with the connect commands, lists changes', async () => {
    const s = server();
    const list = await screen.findByRole('region', { name: 'Your tokens' });
    await within(list).findByText('Laptop');
    expect(within(list).getByText('Read only')).toBeTruthy();
    const changes = screen.getByRole('region', { name: 'Recent changes by assistants' });
    expect(within(changes).getByText('add expense (expense #42)')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Connect an AI assistant' }).textContent).toContain(
      'A token is the secret code you make for one assistant so it can reach your server.',
    );

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Claude Code ' } });
    pick('Access', 'write');
    pick('Expires after', 'never');
    fireEvent.click(screen.getByRole('button', { name: 'Make a token' }));
    const made = await screen.findByRole('region', { name: 'New token' });
    expect(within(made).getByText(TOKEN)).toBeTruthy();
    expect(within(made).getByText(/You will not see it again/)).toBeTruthy();
    const url = `${globalThis.location.origin}/api/v1/mcp`;
    expect(made.textContent).toContain(
      `claude mcp add --transport http milewage ${url} --header "Authorization: Bearer ${TOKEN}"`,
    );
    expect(s.calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Claude Code',
      scope: 'write',
      expires_in_days: null,
    });
    await within(list).findByText('Read and change');

    fireEvent.click(within(made).getByRole('button', { name: 'I have copied it' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'New token' })).toBeNull());
    expect(screen.queryByText(TOKEN)).toBeNull();
  });

  it('revokes a token after a confirmation', async () => {
    const s = server();
    const list = await screen.findByRole('region', { name: 'Your tokens' });
    await within(list).findByText('Laptop');
    menu('Laptop', 'Revoke');
    fireEvent.click(within(list).getByRole('button', { name: 'Confirm revoke' }));
    await within(list).findByText('revoked');
    expect(s.calls.some((c) => c.method === 'DELETE' && c.path === '/mcp/tokens/1')).toBe(true);
  });

  it('builds the Claude Desktop config with mcp-remote and the token in an env value', () => {
    const c = connectText('https://box.tail1.ts.net', TOKEN);
    expect(c.url).toBe('https://box.tail1.ts.net/api/v1/mcp');
    expect(JSON.parse(c.desktop).mcpServers.milewage).toEqual({
      command: 'npx',
      args: [
        '-y',
        'mcp-remote@0.15.2',
        'https://box.tail1.ts.net/api/v1/mcp',
        '--header',
        'Authorization:${MILEWAGE_AUTH}',
      ],
      env: { MILEWAGE_AUTH: `Bearer ${TOKEN}` },
    });
  });

  it('replaces a token after a confirmation and shows the new one once', async () => {
    const s = server();
    const list = await screen.findByRole('region', { name: 'Your tokens' });
    await within(list).findByText('Laptop');
    menu('Laptop', 'Replace token');
    expect(within(list).getByText(/The old token stops working at once/)).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: 'Confirm replace' }));
    const made = await screen.findByRole('region', { name: 'New token' });
    expect(within(made).getByText(TOKEN)).toBeTruthy();
    expect(s.calls.some((c) => c.method === 'POST' && c.path === '/mcp/tokens/1/replace')).toBe(
      true,
    );
  });

  it('a signed-in assistant has only Revoke', async () => {
    renderApp(
      {
        ...signedIn(settingsFixture({ modules: { mcp: true } })),
        'GET /mcp/tokens': () => ({ body: [token({ name: 'Claude Code', kind: 'sign_in' })] }),
        'GET /mcp/audit': () => ({ body: [] }),
      } as never,
      '/settings/assistants',
    );
    const list = await screen.findByRole('region', { name: 'Your tokens' });
    expect(await within(list).findByText('Signed in')).toBeTruthy();
    expect(within(list).getByRole('button', { name: 'Revoke Claude Code' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Actions for Claude Code' })).toBeNull();
  });
});
