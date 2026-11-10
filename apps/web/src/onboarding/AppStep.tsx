import { Button } from '@/components/ui/button';
import { AddressWarning, addressProblem } from '../pairing/address';
import { apkFacts, storeLabel, useAppInfo } from '../pairing/GetTheApp';
import { useSession } from '../session';
import { Qr } from '../ui/Qr';
import { FormError } from '../ui/form';
import { StepForm } from './StepForm';
import type { StepProps } from './steps';

/**
 * Get the app (module `devices`), before Pair your phone: a QR of the public download page
 * (`/app`), which offers the store and the server's own app file. Nothing is saved.
 */
export function AppStep({ next }: StepProps) {
  const { api } = useSession();
  const info = useAppInfo(api);
  const store = info?.store_url ?? null;
  const apk = info?.apk ?? null;
  // A this-computer address cannot open on the phone: say how to fix it instead of a useless QR.
  const local = info ? addressProblem(info.base_url) === 'local' : false;

  return (
    <StepForm save={async () => {}} next={next} skip="I already have the app">
      <p className="text-sm text-muted-foreground">
        Install MileWage on the Android phone you drive with. It records your shifts and sends them
        here.
      </p>
      {info === undefined ? (
        <p className="text-sm text-muted-foreground">Loading</p>
      ) : info === null ? (
        <FormError message="This server did not answer. Reload the page to try again." />
      ) : !store && !apk ? (
        <p role="note" className="text-sm">
          This server has no app to download yet. Put one there first: see the install guide,
          section 3a. Then come back to this step.
        </p>
      ) : local ? (
        <AddressWarning problem="local" />
      ) : (
        <div className="flex flex-wrap items-start gap-6">
          <div className="rounded-lg border bg-qr-plate p-2">
            <Qr text={info.page_url} label="Download page code" />
          </div>
          <div className="min-w-0 flex-1 basis-64 space-y-3 text-sm">
            <p>Scan this code with your phone's camera, or open this address on the phone:</p>
            <p className="font-medium break-all">{info.page_url}</p>
            {store ? (
              <Button asChild variant="outline">
                <a href={store} target="_blank" rel="noopener noreferrer">
                  {storeLabel(store)}
                </a>
              </Button>
            ) : null}
            {apk ? (
              <p className="text-muted-foreground">
                {store ? 'Or the app file from this server: ' : 'The app file from this server: '}
                {apkFacts(apk)}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </StepForm>
  );
}
