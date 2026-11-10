import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button as UiButton } from '@/components/ui/button';
import type { paths } from '@milewage/shared/generated/api-types';
import { errorText, useApiQuery, useChange } from '../api/query';
import { Button, FormError, SelectField } from '../ui/form';
import { PageHeader, Section } from '../ui/layout';

type Ask = paths['/oauth/authorize']['get']['parameters']['query'];

const ACCESS = [
  { value: 'read', label: 'Read only' },
  { value: 'write', label: 'Read and change' },
];
const FIELDS = [
  'client_id',
  'redirect_uri',
  'response_type',
  'code_challenge',
  'code_challenge_method',
  'state',
  'scope',
  'resource',
] as const;

/** Where the browser goes back to, as the driver can check it: the host, or the app's scheme. */
const destination = (uri: string) => {
  const u = URL.parse(uri);
  if (!u) return uri;
  return u.protocol === 'http:' || u.protocol === 'https:' ? u.host : `${u.protocol}//`;
};

/**
 * `/oauth/authorize`: an assistant asks to connect (OAuth sign-in, `mcp/oauth.ts` on the server).
 * The driver is signed in by the time this shows; they choose the access and say yes or no, and
 * the browser goes back to the assistant with the answer.
 */
export function ConnectAssistant() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const query = Object.fromEntries(
    FIELDS.flatMap((k) => (params.has(k) ? [[k, params.get(k)!]] : [])),
  ) as Ask;
  const ask = useApiQuery('/oauth/authorize', { params: { query } }, { retry: false });
  const change = useChange();
  const [access, setAccess] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const info = ask.data;
  const chosen = access ?? info?.scope ?? 'read';

  async function answer(decision: 'allow' | 'deny') {
    const body = { ...query, decision, access: chosen as 'read' | 'write' };
    const done = await change.run((api) => api.POST('/oauth/authorize', { body }));
    if (!done) return;
    setLeaving(true);
    globalThis.location.assign(done.data.redirect_to);
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title="Connect an assistant" />
      {ask.error ? (
        <Section label="Cannot connect">
          <FormError message={errorText(ask)} />
          <p className="text-sm text-muted-foreground">
            Close this tab and start connecting again from your assistant.
          </p>
        </Section>
      ) : !info ? null : leaving ? (
        <Section label="Done">
          <p className="text-sm">
            Going back to {info.client_name}. If nothing happens, close this tab and return to it.
          </p>
        </Section>
      ) : (
        <Section label="Assistant asking">
          <div className="space-y-4">
            <p>
              <span className="font-medium">{info.client_name}</span> wants to reach your MileWage
              records.
            </p>
            <p className="text-sm text-muted-foreground">
              With Read only it can read your shifts, earnings, expenses, goals and tax estimate.
              With Read and change it can also add expenses, earnings lines, odometer readings and
              trips, and fix a shift&rsquo;s notes. It cannot delete anything, see your password,
              backups or GPS points, or change settings.
            </p>
            <SelectField label="Access" value={chosen} onChange={setAccess} options={ACCESS} />
            <p className="text-sm text-muted-foreground">
              After you answer, this page sends you back to{' '}
              <span className="font-mono">{destination(info.redirect_uri)}</span>. Only allow it if
              you started connecting just now. You can disconnect it at any time in Settings &gt; AI
              assistants.
            </p>
            <FormError message={errorText(change)} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" busy={change.busy} onClick={() => void answer('allow')}>
                Allow
              </Button>
              <UiButton
                type="button"
                variant="outline"
                disabled={change.busy}
                onClick={() => void answer('deny')}
              >
                Do not allow
              </UiButton>
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}
