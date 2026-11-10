import { useState } from 'react';
import type { FormEvent } from 'react';
import { Ban, RefreshCw } from 'lucide-react';
import { Button as UiButton } from '@/components/ui/button';
import { errorText, useApiQuery, useChange } from '../api/query';
import type { Schemas } from '../api/client';
import type { paths } from '@milewage/shared/generated/api-types';
import { formatDateTime } from '../format';
import { useSettings } from '../session';
import { Button, Field, FormError, SelectField } from '../ui/form';
import { EmptyState, Section, TableBox, tableClass } from '../ui/layout';
import { RowMenu } from '../ui/RowMenu';

type Token = Schemas['McpToken'];
type Made = paths['/mcp/tokens']['post']['responses'][201]['content']['application/json'];
type Change = paths['/mcp/audit']['get']['responses'][200]['content']['application/json'][number];

const EXPIRY = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: 'A year' },
  { value: 'never', label: 'Never' },
];
const ACCESS = [
  { value: 'read', label: 'Read only' },
  { value: 'write', label: 'Read and change' },
];

/** The ways to connect by signing in: the address, and the Claude Code command without a code. */
export function signInText(origin: string) {
  const url = `${origin}/api/v1/mcp`;
  return { url, code: `claude mcp add --transport http milewage ${url}` };
}

/** The MCP address and the two connect recipes of plan 26 section 3.10, for this server. */
export function connectText(origin: string, token: string) {
  const url = `${origin}/api/v1/mcp`;
  const code = `claude mcp add --transport http milewage ${url} --header "Authorization: Bearer ${token}"`;
  const desktop = JSON.stringify(
    {
      mcpServers: {
        milewage: {
          command: 'npx',
          args: ['-y', 'mcp-remote@0.15.2', url, '--header', 'Authorization:${MILEWAGE_AUTH}'],
          env: { MILEWAGE_AUTH: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
  return { url, code, desktop };
}

function Copyable({ label, text }: { label: string; text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <UiButton
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void navigator.clipboard?.writeText(text).then(() => setDone(true))}
        >
          {done ? 'Copied' : 'Copy'}
        </UiButton>
      </div>
      <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-all">
        {text}
      </pre>
    </div>
  );
}

/** The token just made: shown once, with the ways to connect (plan 26 section 3.9). */
function MadeToken({ made, onDone }: { made: Made; onDone: () => void }) {
  const c = connectText(globalThis.location?.origin ?? '', made.token);
  return (
    <div role="region" aria-label="New token" className="space-y-3 rounded-lg border p-3">
      <p className="text-sm font-medium">
        Copy this token now. You will not see it again; MileWage keeps only a fingerprint of it.
      </p>
      <Copyable label="Token" text={made.token} />
      <Copyable label="Claude Code (on a computer in your tailnet)" text={c.code} />
      <Copyable label="Claude Desktop (claude_desktop_config.json)" text={c.desktop} />
      <p className="text-xs text-muted-foreground">
        Address of this server's MCP endpoint: {c.url}
      </p>
      <UiButton type="button" variant="ghost" size="sm" onClick={onDone}>
        I have copied it
      </UiButton>
    </div>
  );
}

/**
 * One token or signed-in assistant. A token made by hand can be replaced (a new secret, shown
 * once, when the old one is lost) or revoked; a signed-in assistant can only be revoked.
 */
function TokenRow({ t, onMade }: { t: Token; onMade: (made: Made) => void }) {
  const { timezone } = useSettings();
  const [confirming, setConfirming] = useState<'revoke' | 'replace' | null>(null);
  const { run, error } = useChange();
  const at = (ms: number | null, none: string) =>
    ms === null ? none : formatDateTime(ms, timezone);
  const expired = t.expires_at !== null && t.expires_at <= Date.now();
  const state = t.revoked_at !== null ? 'revoked' : expired ? 'expired' : 'active';
  const params = { params: { path: { id: t.id } } };
  const revoke = () => run((api) => api.DELETE('/mcp/tokens/{id}', params));
  async function replace() {
    const done = await run((api) => api.POST('/mcp/tokens/{id}/replace', params));
    setConfirming(null);
    if (done) onMade(done.data);
  }
  const actions =
    state !== 'active' ? null : confirming ? (
      <>
        <UiButton
          type="button"
          variant={confirming === 'revoke' ? 'destructive' : 'default'}
          size="sm"
          onClick={() => void (confirming === 'revoke' ? revoke() : replace())}
        >
          {confirming === 'revoke' ? 'Confirm revoke' : 'Confirm replace'}
        </UiButton>
        <UiButton type="button" variant="ghost" size="sm" onClick={() => setConfirming(null)}>
          Cancel
        </UiButton>
      </>
    ) : t.kind === 'code' ? (
      <RowMenu
        name={t.name}
        actions={[
          { label: 'Replace token', icon: RefreshCw, onSelect: () => setConfirming('replace') },
          {
            label: 'Revoke',
            icon: Ban,
            destructive: true,
            onSelect: () => setConfirming('revoke'),
          },
        ]}
      />
    ) : (
      <UiButton type="button" variant="outline" size="sm" onClick={() => setConfirming('revoke')}>
        Revoke {t.name}
      </UiButton>
    );
  return (
    <tr>
      <td className={state === 'active' ? '' : 'text-muted-foreground line-through'}>
        {t.name}
        {confirming === 'replace' ? (
          <p className="text-xs text-muted-foreground">
            The old token stops working at once. Give the new one to the assistant.
          </p>
        ) : null}
        <FormError message={error} />
      </td>
      <td>{t.scope === 'write' ? 'Read and change' : 'Read only'}</td>
      <td className="text-muted-foreground">{t.kind === 'sign_in' ? 'Signed in' : 'Token'}</td>
      <td className="tabular-nums text-muted-foreground">{at(t.last_used_at, 'never')}</td>
      <td className="tabular-nums text-muted-foreground">{at(t.expires_at, 'never')}</td>
      <td className="text-muted-foreground">{state}</td>
      <td className="text-right whitespace-nowrap">{actions}</td>
    </tr>
  );
}

/** Settings › AI assistants: tokens for the MCP endpoint and what assistants changed (plan 26). */
const NO_CHANGES: Change[] = [];

export function AssistantsCard() {
  const { timezone } = useSettings();
  const tokenList = useApiQuery('/mcp/tokens');
  const audit = useApiQuery('/mcp/audit');
  // Both or neither, as one answer.
  const both = tokenList.data && audit.data;
  const tokens = both ? tokenList.data! : null;
  const changes = both ? audit.data! : NO_CHANGES;
  const [made, setMade] = useState<Made | null>(null);
  const [name, setName] = useState('');
  const [scope, setScope] = useState('read');
  const [expiry, setExpiry] = useState('90');
  const change = useChange();
  const { busy } = change;
  const error = errorText(change, tokenList, audit);

  async function make(e: FormEvent) {
    e.preventDefault();
    const body = {
      name: name.trim(),
      scope: scope as Token['scope'],
      expires_in_days: expiry === 'never' ? null : (Number(expiry) as 30 | 90 | 365),
    };
    const done = await change.run((api) => api.POST('/mcp/tokens', { body }));
    if (!done) return;
    setMade(done.data);
    setName('');
  }

  const signIn = signInText(globalThis.location?.origin ?? '');
  return (
    <div className="space-y-4">
      <Section title="Connect by signing in" label="Connect by signing in">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            The easy way. Give your assistant this address. It opens MileWage in your browser, you
            sign in and press Allow. No code to copy. It works with assistants that run on a
            computer in your tailnet, such as Claude Code, Cursor and VS Code.
          </p>
          <Copyable label="MileWage address for assistants" text={signIn.url} />
          <Copyable label="Claude Code" text={signIn.code} />
          <p className="text-xs text-muted-foreground">
            Then type /mcp in Claude Code, choose milewage and sign in.
          </p>
        </div>
      </Section>
      <Section title="Connect an AI assistant" label="Connect an AI assistant">
        <p className="text-sm text-muted-foreground">
          A token is the secret code you make for one assistant so it can reach your server. You can
          revoke it at any time. An assistant such as Claude can read your shifts, earnings,
          expenses, goals and tax estimate, and with a "Read and change" token add expenses,
          earnings lines, odometer readings and trips, or fix a shift's notes. It sees your notes
          and merchant names too. It cannot delete anything, see your password, backups or GPS
          points, or change settings.
        </p>
        {made ? <MadeToken made={made} onDone={() => setMade(null)} /> : null}
        <form onSubmit={(e) => void make(e)} className="grid gap-3 sm:grid-cols-3">
          <Field
            label="Name"
            placeholder="Claude on my laptop"
            maxLength={64}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <SelectField label="Access" value={scope} onChange={setScope} options={ACCESS} />
          <SelectField label="Expires after" value={expiry} onChange={setExpiry} options={EXPIRY} />
          <div className="sm:col-span-3">
            <Button type="submit" busy={busy} disabled={!name.trim()}>
              Make a token
            </Button>
          </div>
        </form>
        <FormError message={error} />
      </Section>
      <Section title="Your tokens" label="Your tokens">
        {tokens === null ? null : tokens.length === 0 ? (
          <EmptyState>No tokens yet.</EmptyState>
        ) : (
          <TableBox>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Access</th>
                  <th>How</th>
                  <th>Last used</th>
                  <th>Expires</th>
                  <th>State</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <TokenRow key={t.id} t={t} onMade={setMade} />
                ))}
              </tbody>
            </table>
          </TableBox>
        )}
      </Section>
      <Section title="Recent changes by assistants" label="Recent changes by assistants">
        {changes.length === 0 ? (
          <EmptyState>No changes yet.</EmptyState>
        ) : (
          <ul className="divide-y text-sm">
            {changes.map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  {c.tool.replaceAll('_', ' ')}
                  {c.target ? ` (${c.target.replace(':', ' #')})` : ''}
                  {c.outcome === 'ok' ? '' : ` — refused: ${c.outcome.replace(/^error: /, '')}`}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {c.token_name}, {formatDateTime(c.at, timezone)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
