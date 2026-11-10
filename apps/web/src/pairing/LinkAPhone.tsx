import { useState } from 'react';
import { DevicesIcon } from '@/ui/icons';
import { Button } from '@/components/ui/button';
import { useApiQuery, useChange } from '../api/query';
import type { paths } from '@milewage/shared/generated/api-types';
import { Field, FormError } from '../ui/form';

type Waiting =
  paths['/link-requests']['get']['responses'][200]['content']['application/json'][number];

/** How often the page looks for phones waiting to link (the phone polls every 2 s). */
export const LINK_POLL_MS = 3000;

/**
 * Link a phone found on the Wi-Fi (plan 28 section 4.4): the phone shows a 6-digit code, the
 * driver types it here, next to the phone's name and address, so the right phone is linked
 * (RFC 8628, Jellyfin Quick Connect). Not a <form>: the wizard's phone step already sits in one.
 */
export function LinkAPhone() {
  // A failed look is not shown: the list is asked for again on the next tick.
  const waiting =
    useApiQuery('/link-requests', undefined, { refetchInterval: LINK_POLL_MS }).data ?? null;
  const [linked, setLinked] = useState<string | null>(null);

  return (
    <div role="region" aria-label="Link a phone on your Wi-Fi" className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Open MileWage on your phone, on your home Wi-Fi. It finds this server by itself: tap it,
        then type here the code the phone shows.
      </p>
      {linked ? (
        <p role="status" className="text-sm font-medium">
          {linked} is linked.
        </p>
      ) : null}
      {waiting?.length ? (
        <ul className="space-y-3">
          {waiting.map((w) => (
            <WaitingPhone key={w.id} phone={w} onLinked={setLinked} />
          ))}
        </ul>
      ) : waiting && !linked ? (
        <p role="status" className="text-sm text-muted-foreground">
          No phone is waiting to link yet.
        </p>
      ) : null}
    </div>
  );
}

function WaitingPhone({ phone, onLinked }: { phone: Waiting; onLinked: (name: string) => void }) {
  const [code, setCode] = useState('');
  const { run, busy, error } = useChange();
  // Not linking is not an error worth showing: an unanswered request runs out on the server.
  const dropping = useChange();

  async function link() {
    if (busy || !code.trim()) return;
    const user_code = code.trim();
    const ok = await run((api) => api.POST('/link-requests/approve', { body: { user_code } }));
    if (ok) onLinked(ok.data.device_name);
  }

  async function drop() {
    await dropping.run((api) =>
      api.DELETE('/link-requests/{id}', { params: { path: { id: phone.id } } }),
    );
  }

  return (
    <li
      className="space-y-2 rounded-lg border p-3"
      aria-label={`${phone.device_name} wants to link`}
    >
      <p className="flex items-center gap-2 text-sm">
        <DevicesIcon className="size-5 shrink-0" />
        <span>
          <span className="font-medium">{phone.device_name}</span> wants to link{' '}
          <span className="text-muted-foreground">(from {phone.from})</span>
        </span>
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40">
          <Field
            label="Code shown on the phone"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              void link();
            }}
          />
        </div>
        <Button type="button" disabled={busy || !code.trim()} onClick={() => void link()}>
          Link
        </Button>
        <Button type="button" variant="ghost" onClick={() => void drop()}>
          Not my phone
        </Button>
      </div>
      <FormError message={error} />
    </li>
  );
}
