import { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { unwrap } from '../api/client';
import { useChange } from '../api/query';
import type { paths } from '@milewage/shared/generated/api-types';
import { useSession } from '../session';
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
export function LinkAPhone({ onLinked }: { onLinked?: (name: string) => void }) {
  const { api } = useSession();
  const [waiting, setWaiting] = useState<Waiting[] | null>(null);
  const [linked, setLinked] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const look = () =>
      unwrap(api.GET('/link-requests')).then(
        (list) => live && setWaiting(list),
        () => {}, // try again on the next tick
      );
    void look();
    const timer = setInterval(() => void look(), LINK_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api]);

  const done = (name: string, id: number) => {
    setLinked(name);
    setWaiting((w) => w?.filter((x) => x.id !== id) ?? null);
    onLinked?.(name);
  };

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
            <WaitingPhone
              key={w.id}
              phone={w}
              onLinked={(name) => done(name, w.id)}
              onDropped={() => setWaiting((l) => l?.filter((x) => x.id !== w.id) ?? null)}
            />
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

function WaitingPhone({
  phone,
  onLinked,
  onDropped,
}: {
  phone: Waiting;
  onLinked: (name: string) => void;
  onDropped: () => void;
}) {
  const [code, setCode] = useState('');
  const { run, busy, error } = useChange();
  // Not linking is not an error worth showing: the phone drops out of the list either way.
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
    onDropped();
  }

  return (
    <li
      className="space-y-2 rounded-lg border p-3"
      aria-label={`${phone.device_name} wants to link`}
    >
      <p className="flex items-center gap-2 text-sm">
        <Smartphone aria-hidden="true" className="size-4" />
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
