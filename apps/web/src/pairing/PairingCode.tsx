import { useState } from 'react';
import { Button as UiButton } from '@/components/ui/button';
import { formatTime } from '../format';
import { useSession, useSettings } from '../session';
import { Qr } from '../ui/Qr';
import { Field, FormError } from '../ui/form';
import { AddressWarning, addressProblem } from './address';
import { AppButtons, useAppAvailable } from './GetTheApp';
import type { Pairing, PairingSession } from './session';

const SOURCE: Record<Pairing['base_url_source'], string> = {
  configured: 'set on the server',
  request: 'the address this page is open at',
  driver: 'you changed it',
};

/**
 * The one-time pairing QR and its link, on the Devices page and in the wizard's phone step
 * (plan 23). The QR carries the `https://<server>/pair#…` link any camera opens; "Open in the
 * MileWage app" and "Get the app" sit beside it (plan 24 section 4.3). The address inside it is
 * shown with Change address, and a warning comes first when the phone app cannot use it (plan 19
 * section 3.3). Change address renews the session's code with the driver's address. Before there
 * is a code, only the reason asking for one failed is shown.
 */
export function PairingCode({ session }: { session: PairingSession }) {
  const { code: pairing, busy, error, renew } = session;
  const { api } = useSession();
  const { timezone } = useSettings();
  const available = useAppAvailable(api);
  const [address, setAddress] = useState<string | null>(null); // non-null while changing

  // Not a <form>: the wizard's phone step already sits inside one.
  async function change() {
    if (busy || !address?.trim()) return;
    if (await renew(address)) setAddress(null);
  }

  if (!pairing) return <FormError message={error} />;
  const problem = addressProblem(pairing.base_url);
  return (
    <div className="space-y-4">
      <AddressWarning problem={problem} />
      <div className="flex flex-wrap items-start gap-6">
        {problem === 'local' ? null : (
          <div className="rounded-lg border bg-white p-2">
            <Qr text={pairing.pair_url} label="Pairing code" />
          </div>
        )}
        <div className="min-w-0 flex-1 basis-64 space-y-3">
          {problem === 'local' ? null : (
            <p className="text-sm text-muted-foreground">
              Open MileWage on your phone and tap Scan the code. Valid once, until{' '}
              {formatTime(pairing.expires_at, timezone)}.
            </p>
          )}
          <AppButtons link={pairing.qr_payload} available={available} />
          <Addresses pairing={pairing} />
          {address === null ? (
            <UiButton
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-0"
              onClick={() => setAddress(pairing.base_url)}
            >
              Change address
            </UiButton>
          ) : (
            <div role="group" aria-label="Change address" className="space-y-2">
              <Field
                label="Server address"
                hint="Your Tailscale address, for example https://milewage-box.tail1234.ts.net, or the server's address on your home network, for example http://192.168.1.20:8080"
                inputMode="url"
                autoComplete="off"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  void change();
                }}
              />
              <FormError message={error} />
              <div className="flex gap-2">
                <UiButton
                  type="button"
                  size="sm"
                  disabled={busy || !address.trim()}
                  onClick={() => void change()}
                >
                  Make a new code
                </UiButton>
                <UiButton type="button" variant="ghost" size="sm" onClick={() => setAddress(null)}>
                  Cancel
                </UiButton>
              </div>
            </div>
          )}
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer">Show code text</summary>
            <code className="mt-1 block break-all font-mono text-xs">{pairing.qr_payload}</code>
          </details>
          {/* A new code that could not be made when this one ran out. */}
          {address === null && session.state === 'expired' ? <FormError message={error} /> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Where the phone connects (plan 28 section 4.2), said plainly: the home address on the Wi-Fi,
 * the away address everywhere else, and what happens when there is no away address.
 */
function Addresses({ pairing }: { pairing: Pairing }) {
  const { home_url: home, away_url: away, base_url: base, base_url_source: source } = pairing;
  const from = (url: string) =>
    url === base ? <span className="text-muted-foreground"> ({SOURCE[source]})</span> : null;
  if (!home && !away) {
    return (
      <p className="text-sm">
        Your phone will connect to <span className="font-medium break-all">{base}</span>
        {from(base)}
      </p>
    );
  }
  return (
    <ul className="space-y-1 text-sm">
      {home ? (
        <li>
          <span className="font-medium">At home:</span> <span className="break-all">{home}</span>
          {from(home)}, used when the phone is on your Wi-Fi.
          {home.startsWith('http:') ? (
            <span className="block text-xs text-muted-foreground">
              Plain http: not encrypted on your home network.
            </span>
          ) : null}
        </li>
      ) : null}
      <li>
        <span className="font-medium">Away:</span>{' '}
        {away ? (
          <>
            <span className="break-all">{away}</span>
            {from(away)}, used everywhere else.
          </>
        ) : (
          <>
            not set up. The phone sends shifts when it is back on your Wi-Fi. To send them from
            anywhere, set up Tailscale (the install guide, section 3).
          </>
        )}
      </li>
    </ul>
  );
}
