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
    // The token is shown once, on its own; no command or file holds it.
    expect(made.textContent).toContain('read -rs MILEWAGE_TOKEN && export MILEWAGE_TOKEN');
    expect(made.textContent).toContain(
      `claude mcp add --transport http milewage ${url} --header 'Authorization: Bearer \${MILEWAGE_TOKEN}'`,
    );
    expect(made.textContent).toContain('Do not paste this token into a chat or a ticket.');
    expect(made.textContent!.split(TOKEN)).toHaveLength(2);
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

  it('builds the Claude Desktop config with mcp-remote and a place for the token', () => {
    const c = connectText('https://box.tail1.ts.net');
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
      env: { MILEWAGE_AUTH: 'Bearer <paste the token here>' },
    });
  });

  it('tests the connection and names the cause', async () => {
    const s = renderApp(
      {
        ...signedIn(settingsFixture({ modules: { mcp: true } })),
        'GET /mcp/tokens': () => ({ body: [] }),
        'GET /mcp/audit': () => ({ body: [] }),
        'GET /mcp/connection': () => ({
          body: {
            ok: false,
            address: 'https://milewage.lan',
            mcp_url: 'http://milewage.lan/api/v1/mcp',
            seen: { protocol: 'http', host: 'milewage.lan', via: '192.168.1.10' },
            public_url: null,
            home_url: null,
            findings: [
              { code: 'wrong_address', message: 'Assistants are told to use http.' },
              {
                code: 'proxy_not_trusted',
                message: 'Put the address in MILEWAGE_TRUSTED_PROXIES.',
              },
              { code: 'own_certificate', message: 'Set NODE_EXTRA_CA_CERTS.' },
            ],
          },
        }),
      } as never,
      '/settings/assistants',
    );
    const panel = await screen.findByRole('region', { name: 'Test the connection' });
    expect(s.calls.some((c) => c.path === '/mcp/connection')).toBe(false); // only when asked
    fireEvent.click(within(panel).getByRole('button', { name: 'Test connection' }));
    const result = await within(panel).findByRole('status');
    expect(result.textContent).toContain(
      'Assistants would be sent to http://milewage.lan/api/v1/mcp, not https://milewage.lan/api/v1/mcp.',
    );
    expect(result.textContent).toContain('MileWage saw http://milewage.lan, from 192.168.1.10.');
    expect(
      within(result)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Assistants are told to use http.', 'Put the address in MILEWAGE_TRUSTED_PROXIES.']);
    expect(result.textContent).toContain('Set NODE_EXTRA_CA_CERTS.');
    const call = s.calls.find((c) => c.path === '/mcp/connection')!;
    expect(new URLSearchParams(call.query).get('address')).toBe(globalThis.location.origin);
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
