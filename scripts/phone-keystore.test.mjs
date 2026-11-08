import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const keystoreScript = fileURLToPath(new URL('./phone-keystore.sh', import.meta.url));
const signingEnv = fileURLToPath(new URL('./phone-signing-env.sh', import.meta.url));
const repo = fileURLToPath(new URL('..', import.meta.url));
const hasKeytool = spawnSync('sh', ['-c', 'command -v keytool'], { encoding: 'utf8' }).status === 0;

let home;
beforeEach(() => void (home = mkdtempSync(join(tmpdir(), 'mw-keystore-'))));
afterEach(() => rmSync(home, { recursive: true, force: true }));

// A clean environment: HOME is the temp dir and no MILEWAGE_* variable leaks in from the caller.
function env(extra = {}) {
  const base = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('MILEWAGE_')),
  );
  return { ...base, HOME: home, ...extra };
}
const run = (args, extra) =>
  spawnSync('bash', [keystoreScript, ...args], { env: env(extra), encoding: 'utf8' });
const parseEnv = (text) =>
  Object.fromEntries([...text.matchAll(/^(MILEWAGE_\w+)='([^']*)'$/gm)].map((m) => [m[1], m[2]]));

describe('scripts/phone-keystore.sh', () => {
  (hasKeytool ? test : test.skip)(
    'makes an RSA 2048 upload key and a mode 600 settings file under HOME',
    () => {
      const r = run([]);
      expect(r.status, r.stderr).toBe(0);
      const keystore = join(home, '.milewage', 'upload.keystore');
      const envFile = join(home, '.milewage', 'keystore.env');
      expect(statSync(keystore).mode & 0o777).toBe(0o600);
      expect(statSync(envFile).mode & 0o777).toBe(0o600);
      const vars = parseEnv(readFileSync(envFile, 'utf8'));
      expect(vars).toMatchObject({
        MILEWAGE_KEYSTORE_PATH: keystore,
        MILEWAGE_KEY_ALIAS: 'milewage-upload',
      });
      expect(vars.MILEWAGE_KEYSTORE_PASSWORD).toMatch(/^[A-Za-z0-9]{32}$/);
      expect(vars.MILEWAGE_KEY_PASSWORD).toBe(vars.MILEWAGE_KEYSTORE_PASSWORD);
      expect(r.stdout).toContain(vars.MILEWAGE_KEYSTORE_PASSWORD);
      expect(r.stdout).toMatch(/BACK THIS UP/);
      expect(r.stdout).toMatch(/password manager/);
      expect(r.stdout).toMatch(/new app identity on Google Play/);

      const list = spawnSync(
        'keytool',
        ['-list', '-v', '-keystore', keystore, '-storepass', vars.MILEWAGE_KEYSTORE_PASSWORD],
        { encoding: 'utf8' },
      );
      expect(list.status, list.stderr).toBe(0);
      expect(list.stdout).toMatch(/Alias name: milewage-upload/);
      expect(list.stdout).toMatch(/2048-bit RSA key/);
      const valid = /Valid from: (.+) until: (.+)/.exec(list.stdout);
      const days = (Date.parse(valid[2]) - Date.parse(valid[1])) / 86_400_000;
      expect(Math.round(days)).toBe(10000);

      // A second run must not replace the key.
      const before = readFileSync(keystore);
      const again = run([]);
      expect(again.status).toBe(1);
      expect(again.stderr).toMatch(/Refusing to overwrite/);
      expect(readFileSync(keystore).equals(before)).toBe(true);
    },
    // keytool starts a JVM and makes an RSA 2048 key, three times over here; on GitHub's shared
    // runner that took longer than the 5 s default (0.4 s on a workstation).
    60_000,
  );

  test('refuses to overwrite an existing keystore given with --out', () => {
    const out = join(home, 'mine.keystore');
    writeFileSync(out, 'existing');
    const r = run(['--out', out]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Refusing to overwrite/);
    expect(readFileSync(out, 'utf8')).toBe('existing');
    expect(existsSync(join(home, '.milewage', 'keystore.env'))).toBe(false);
  });

  test('refuses to write the key inside the repository', () => {
    const out = join(repo, 'apps', 'phone', 'never.keystore');
    const r = run(['--out', out]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/inside the repository/);
    expect(existsSync(out)).toBe(false);
  });

  // Read the file rather than ask git: the CI image (node slim) has no git.
  test('*.keystore and *.jks are ignored by git', () => {
    const lines = readFileSync(join(repo, '.gitignore'), 'utf8').split('\n');
    expect(lines).toContain('*.keystore');
    expect(lines).toContain('*.jks');
  });
});

describe('scripts/phone-signing-env.sh', () => {
  const probe = (extra) =>
    spawnSync(
      'bash',
      [
        '-c',
        `. "${signingEnv}" && milewage_signing_env && echo "PATH_IS=\${MILEWAGE_KEYSTORE_PATH:-}" && echo "ALIAS_IS=\${MILEWAGE_KEY_ALIAS:-}"`,
      ],
      { env: env(extra), encoding: 'utf8' },
    );

  test('without a settings file the release build keeps the debug key', () => {
    const r = probe();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/Expo DEBUG key/);
    expect(r.stdout).toMatch(/^PATH_IS=$/m);
  });

  test('exports the upload key settings from $HOME/.milewage/keystore.env', () => {
    mkdirSync(join(home, '.milewage'));
    const ks = join(home, '.milewage', 'upload.keystore');
    writeFileSync(ks, 'key');
    writeFileSync(
      join(home, '.milewage', 'keystore.env'),
      `MILEWAGE_KEYSTORE_PATH='${ks}'\nMILEWAGE_KEYSTORE_PASSWORD='p'\nMILEWAGE_KEY_ALIAS='milewage-upload'\nMILEWAGE_KEY_PASSWORD='p'\n`,
    );
    const r = probe();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`Signing with the upload key ${ks}`);
    expect(r.stdout).toContain(`PATH_IS=${ks}`);
    expect(r.stdout).toContain('ALIAS_IS=milewage-upload');
  });

  test('MILEWAGE_KEYSTORE_ENV picks another file; a missing one or a missing value fails', () => {
    const file = join(home, 'ci.env');
    expect(probe({ MILEWAGE_KEYSTORE_ENV: file }).status).toBe(1);
    const ks = join(home, 'k.keystore');
    writeFileSync(ks, 'key');
    writeFileSync(file, `MILEWAGE_KEYSTORE_PATH='${ks}'\nMILEWAGE_KEY_ALIAS='a'\n`);
    const r = probe({ MILEWAGE_KEYSTORE_ENV: file });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/MILEWAGE_KEYSTORE_PASSWORD is not set/);
  });

  test('the release build script sources it before Gradle runs', () => {
    const build = readFileSync(new URL('./phone-release-build.sh', import.meta.url), 'utf8');
    const sourced = build.indexOf('milewage_signing_env');
    expect(sourced).toBeGreaterThan(0);
    expect(sourced).toBeLessThan(build.indexOf('./gradlew'));
  });
});
