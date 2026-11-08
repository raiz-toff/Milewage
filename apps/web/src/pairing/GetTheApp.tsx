import { useEffect, useState } from 'react';
import { Download, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Api } from '../api/client';
import type { paths } from '@milewage/shared/generated/api-types';

/** Where the server hands out its own phone app (plan 24 Q2). */
export const APK_URL = '/api/v1/app/android.apk';
/** The public download page (no sign-in): the store link and the app file. */
export const APP_PAGE = '/app';

export type AppInfo = paths['/app']['get']['responses'][200]['content']['application/json'];
export type ApkInfo = NonNullable<AppInfo['apk']>;

/** `GET /app`: undefined while loading, null when it could not be read. */
export function useAppInfo(api: Api): AppInfo | null | undefined {
  const [info, setInfo] = useState<AppInfo | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    api.GET('/app').then(
      (r) => live && setInfo(r.data ?? null),
      () => live && setInfo(null),
    );
    return () => {
      live = false;
    };
  }, [api]);
  return info;
}

/** True once the server offers the app (its own file or a store page); the link stays hidden otherwise. */
export function useAppAvailable(api: Api): boolean {
  const info = useAppInfo(api);
  return !!(info?.apk || info?.store_url);
}

/** "Version 0.1.0 · 108 MB · Nov 7, 2026" (the version only when the build script wrote it). */
export function apkFacts(apk: ApkInfo): string {
  const mb = new Intl.NumberFormat(undefined, {
    style: 'unit',
    unit: 'megabyte',
    maximumFractionDigits: 0,
  }).format(apk.size_bytes / 1e6);
  const day = new Date(apk.updated_at).toLocaleDateString(undefined, { dateStyle: 'medium' });
  return [apk.version ? `Version ${apk.version}` : null, mb, day].filter(Boolean).join(' · ');
}

/** The store button's words: Google Play by name only for a Google Play link. */
export const storeLabel = (url: string) =>
  /^https:\/\/play\.google\.com\//.test(url)
    ? 'Get it on Google Play'
    : 'Get it from the app store';

/** This page is open on an Android phone, where the app link can open MileWage directly. */
export const onAndroid = () => /Android/i.test(globalThis.navigator?.userAgent ?? '');

/** "Open in the MileWage app" (when on the phone) and "Get the app" (when the server offers it). */
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
          <a href={APP_PAGE}>
            <Download />
            Get the app
          </a>
        </Button>
      ) : null}
    </div>
  );
}
