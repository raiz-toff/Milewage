import { pairingLinks, parsePairingLink } from '@milewage/shared';
import { useMemo } from 'react';
import { createApi } from '../api/client';
import { AppButtons, onAndroid, useAppAvailable } from '../pairing/GetTheApp';

/**
 * `/pair#v=1&t=<token>[&h=<home address>]`: what the pairing QR opens in a phone's own camera app (plan 24 Q1,
 * fallback). It needs no sign-in and hands the code to the MileWage app with the
 * `milewage://pair` link. The token is in the fragment, so it never reaches the server.
 */
export function PairPage() {
  const api = useMemo(() => createApi(), []);
  const available = useAppAvailable(api);
  const { origin, pathname, hash } = globalThis.location;
  // The page link the QR showed, read with the one shared format: the home address `h` goes on.
  const code = parsePairingLink(origin + pathname + hash);
  const ok = code !== null;
  const link = code ? pairingLinks(code).appLink : '';
  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-headline-small text-on-surface md:text-headline-medium">
        Connect your phone to MileWage
      </h1>
      {ok ? (
        <>
          <p className="text-muted-foreground">
            {onAndroid()
              ? 'Tap Open in the MileWage app. The app asks you to confirm this server.'
              : 'Open this page on the Android phone you drive with.'}
          </p>
          <AppButtons link={link} available={available} />
          {available ? (
            <p className="text-body-medium text-muted-foreground">
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
