import { useEffect, useState } from 'react';
import { Download, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Api } from '../api/client';

/** Where the server hands out its own phone app (plan 24 Q2). */
export const APK_URL = '/api/v1/app/android.apk';

/** True once the server says it has the app file; the link stays hidden otherwise. */
export function useAppAvailable(api: Api): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let live = true;
    api.HEAD('/app/android.apk').then(
      (r) => live && setOk(r.response.ok),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api]);
  return ok;
}

/** This page is open on an Android phone, where the app link can open MileWage directly. */
export const onAndroid = () => /Android/i.test(globalThis.navigator?.userAgent ?? '');

/** "Open in the MileWage app" (when on the phone) and "Get the app" (when the server has it). */
export function AppButtons({ link, available }: { link: string; available: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {onAndroid() ? (
        <Button asChild>
          <a href={link}>
            <Smartphone />
            Open in the MileWage app
          </a>
        </Button>
      ) : null}
      {available ? (
        <Button asChild variant="outline">
          <a href={APK_URL} download="milewage.apk">
            <Download />
            Get the app
          </a>
        </Button>
      ) : null}
    </div>
  );
}
