/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

jest.mock('expo/config-plugins', () => ({
  withAndroidManifest: (config: any, fn: (c: any) => any) => fn(config),
}));

const {
  ALLOWED,
  FORBIDDEN,
  PREFIX,
  forbiddenIn,
  requestedPermissions,
} = require('../plugins/manifestPolicy');
const withManifestPolicy = require('../plugins/withManifestPolicy');

const root = join(__dirname, '..');
const moduleDir = join(root, 'native', 'comma-tracker', 'android', 'src', 'main');
const read = (p: string) => readFileSync(p, 'utf8');

describe('manifest lint (09 section 5.3)', () => {
  it('app.config.js declares exactly the allowed permissions and no forbidden one', () => {
    const declared: string[] = require('../app.config.js').expo.android.permissions;
    expect([...declared].sort()).toEqual([...ALLOWED].sort());
    expect(declared.map((p) => PREFIX + p).filter((p) => FORBIDDEN.includes(p))).toEqual([]);
  });

  it('the tracker module manifest requests no forbidden permission and has no boot receiver', () => {
    const xml = read(join(moduleDir, 'AndroidManifest.xml'));
    expect(forbiddenIn(xml)).toEqual([]);
    expect(xml).not.toMatch(/BOOT_COMPLETED|BootReceiver/);
  });

  it('the overlay and boot receiver classes are gone', () => {
    const dir = join(moduleDir, 'java', 'expo', 'modules', 'commatracker');
    expect(existsSync(join(dir, 'ShiftOverlay.kt'))).toBe(false);
    expect(existsSync(join(dir, 'BootReceiver.kt'))).toBe(false);
  });

  it('the lint finds forbidden permissions and ignores tools:node="remove"', () => {
    const xml = `<manifest>
      <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>
      <uses-permission android:name="android.permission.RECORD_AUDIO" tools:node="remove"/>
      <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
      <uses-permission android:name="android.permission.INTERNET"/></manifest>`;
    expect(requestedPermissions(xml)).toHaveLength(3);
    expect(forbiddenIn(xml)).toEqual([
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
    ]);
  });

  it('the config plugin removes every forbidden permission, including ones already present', () => {
    const config = {
      modResults: {
        manifest: {
          'uses-permission': [
            { $: { 'android:name': PREFIX + 'SYSTEM_ALERT_WINDOW' } },
            { $: { 'android:name': PREFIX + 'ACCESS_FINE_LOCATION' } },
          ],
        },
      },
    };
    const out = withManifestPolicy(config).modResults.manifest;
    expect(out.$['xmlns:tools']).toBeDefined();
    const kept = out['uses-permission'].filter((p: any) => !p.$['tools:node']);
    const removed = out['uses-permission'].filter((p: any) => p.$['tools:node'] === 'remove');
    expect(kept.map((p: any) => p.$['android:name'])).toEqual([PREFIX + 'ACCESS_FINE_LOCATION']);
    expect(removed.map((p: any) => p.$['android:name'])).toEqual(FORBIDDEN);
  });

  // Runs after a release build (scripts/phone-release-build.sh); skipped when no build output exists.
  const merged = join(
    root,
    'android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml',
  );
  (existsSync(merged) ? it : it.skip)(
    'the merged release manifest has no forbidden permission',
    () => {
      expect(forbiddenIn(read(merged))).toEqual([]);
    },
  );

  // No Google ML Kit and no Google usage logging (datatransport): the QR scanner is ZXing
  // (plan 24 section 6, Q1). expo-camera and the other Android scanners all use ML Kit.
  const GOOGLE_SCANNING = /mlkit|datatransport|barcode-scanning|play-services-code-scanner/i;
  it('no dependency brings Google ML Kit or its usage logging', () => {
    const deps = Object.keys(JSON.parse(read(join(root, 'package.json'))).dependencies);
    expect(deps.filter((d) => /expo-camera|vision-camera|ml-kit|mlkit/.test(d))).toEqual([]);
    const gradle = read(join(root, 'native', 'qr-scanner', 'android', 'build.gradle'));
    expect(gradle).toMatch(/com\.journeyapps:zxing-android-embedded/);
    for (const m of ['qr-scanner', 'comma-tracker']) {
      expect(read(join(root, 'native', m, 'android', 'build.gradle'))).not.toMatch(GOOGLE_SCANNING);
    }
  });
  (existsSync(merged) ? it : it.skip)('the merged release manifest has no ML Kit', () => {
    expect(read(merged)).not.toMatch(GOOGLE_SCANNING);
  });

  // Tailscale is the only other app MileWage may see (Android 11 package visibility).
  const TAILSCALE = /<package android:name="com\.tailscale\.ipn"\s*\/>/;
  it('the network check module asks to see Tailscale and nothing else', () => {
    const xml = read(
      join(root, 'native', 'net-check', 'android', 'src', 'main', 'AndroidManifest.xml'),
    );
    expect(xml).toMatch(TAILSCALE);
    expect(xml.match(/<package /g)).toHaveLength(1);
    expect(forbiddenIn(xml)).toEqual([]);
  });
  (existsSync(merged) ? it : it.skip)('the merged release manifest can see Tailscale', () => {
    expect(read(merged)).toMatch(TAILSCALE);
  });

  // Every permission in the merged manifest is one we declared or a known harmless library one.
  const BENIGN = ['INTERNET', 'VIBRATE', 'ACCESS_NETWORK_STATE'].map((n) => PREFIX + n);
  (existsSync(merged) ? it : it.skip)(
    'the merged release manifest requests only known permissions',
    () => {
      const wanted = [...ALLOWED.map((n: string) => PREFIX + n), ...BENIGN];
      const extra = requestedPermissions(read(merged)).filter(
        (n: string) =>
          !wanted.includes(n) && !n.endsWith('.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'),
      );
      expect(extra).toEqual([]);
    },
  );
});
