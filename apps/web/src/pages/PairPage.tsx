import { useMemo } from 'react';
import { createApi } from '../api/client';
import { AppButtons, onAndroid, useAppAvailable } from '../pairing/GetTheApp';

/**
 * `/pair#v=1&t=<token>`: what the pairing QR opens in a phone's own camera app (plan 24 Q1,
 * fallback). It needs no sign-in and hands the code to the MileWage app with the
 * `milewage://pair` link. The token is in the fragment, so it never reaches the server.
 */
export function PairPage() {
  const api = useMemo(() => createApi(), []);
  const available = useAppAvailable(api);
  const params = new URLSearchParams(globalThis.location.hash.slice(1));
  const token = params.get('t') ?? '';
  const ok = params.get('v') === '1' && /^mwp_[A-Za-z0-9_-]{10,}$/.test(token);
  const base = globalThis.location.origin + globalThis.location.pathname.replace(/\/pair\/?$/, '');
  const link = `milewage://pair?v=1&u=${encodeURIComponent(base)}&t=${token}`;
  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Connect your phone to MileWage</h1>
      {ok ? (
        <>
          <p className="text-muted-foreground">
            {onAndroid()
              ? 'Tap Open in the MileWage app. The app asks you to confirm this server.'
              : 'Open this page on the Android phone you drive with.'}
          </p>
          <AppButtons link={link} available={available} />
          {available ? (
            <p className="text-sm text-muted-foreground">
              No app yet? Get the app, install it, then come back to this page and tap Open in the
              MileWage app.
            </p>
          ) : null}
        </>
      ) : (
        <p role="alert" className="text-muted-foreground">
          This link is not complete. On your computer, open MileWage, then Devices, and make a new
          code.
        </p>
      )}
    </main>
  );
}
