import { useEffect, useMemo } from 'react';
import { DownloadIcon } from '@/ui/icons';
import { Button } from '@/components/ui/button';
import { createApi } from '../api/client';
import { APK_URL, apkFacts, storeLabel, useAppInfo } from '../pairing/GetTheApp';

/**
 * `/app`: the download page the setup wizard's QR opens on the phone (no sign-in; the phone has
 * no account yet). The store first when the app is published, then the server's own app file
 * with its size and date and how Android asks to allow the install.
 */
export function AppPage() {
  const api = useMemo(() => createApi(), []);
  const info = useAppInfo(api);
  useEffect(() => {
    document.title = 'Get the app — MileWage';
  }, []);
  const store = info?.store_url ?? null;
  const apk = info?.apk ?? null;

  return (
    <main className="mx-auto max-w-md space-y-5 px-4 py-8">
      <h1 className="text-headline-small text-on-surface md:text-headline-medium">
        Get MileWage for Android
      </h1>
      <p className="text-muted-foreground">
        The MileWage app records your shifts on this phone and sends them to your own server.
      </p>
      {info === undefined ? (
        <p className="text-body-medium text-muted-foreground">Loading</p>
      ) : info === null ? (
        <p role="alert">This server did not answer. Reload the page to try again.</p>
      ) : !store && !apk ? (
        <p role="status">
          This server has no app to download yet. Put one there first: see the install guide,
          section 3a.
        </p>
      ) : (
        <>
          {store ? (
            <Button asChild size="lg" className="w-full">
              <a href={store} rel="noopener noreferrer">
                {storeLabel(store)}
              </a>
            </Button>
          ) : null}
          {apk ? (
            <section className="space-y-3" aria-label="Download from your server">
              {store ? (
                <p className="text-body-medium text-muted-foreground">Or download it directly:</p>
              ) : null}
              <Button asChild size="lg" variant={store ? 'outline' : 'default'} className="w-full">
                <a href={APK_URL} download="milewage.apk">
                  <DownloadIcon />
                  Download MileWage
                </a>
              </Button>
              <p className="text-center text-body-medium text-muted-foreground">{apkFacts(apk)}</p>
              <h2 className="pt-2 text-title-medium">Installing the download</h2>
              <ol className="list-decimal space-y-1 pl-5 text-body-medium">
                <li>Open the file from the download notification, or from Downloads.</li>
                <li>
                  The first time, Android asks to let your browser install apps: tap Settings, turn
                  on Allow from this source, then go back.
                </li>
                <li>Tap Install, then open MileWage.</li>
              </ol>
            </section>
          ) : null}
          <p className="text-body-medium text-muted-foreground">
            Next: on your computer, open MileWage and scan the pairing code with the app.
          </p>
        </>
      )}
      <p className="border-t pt-4 text-body-medium text-muted-foreground">
        What the app records and who else sees it:{' '}
        <a href="/privacy" className="underline underline-offset-4 hover:text-foreground">
          Privacy
        </a>
      </p>
    </main>
  );
}
