/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';

jest.mock('expo/config-plugins', () => ({
  withAppBuildGradle: (config: any, fn: (c: any) => any) => fn(config),
}));

const {
  MARKER,
  RELEASE_CONFIG,
  RELEASE_USES,
  addReleaseSigning,
} = require('../plugins/releaseSigning');
const withReleaseSigning = require('../plugins/withReleaseSigning');

// The android/app/build.gradle that `expo prebuild` starts from, straight from the installed Expo.
const template = execFileSync(
  'tar',
  [
    '-xzOf',
    join(dirname(require.resolve('expo/package.json')), 'template.tgz'),
    'package/android/app/build.gradle',
  ],
  { encoding: 'utf8' },
);

/** The text of the first `name {` block after `from`, braces balanced. */
function block(text: string, name: string, from = 0): string {
  const start = text.indexOf(`${name} {`, from);
  if (start < 0) throw new Error(`no ${name} block`);
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name} block`);
}

describe('release signing config plugin', () => {
  it('the Expo template still signs release builds with the debug key (what we replace)', () => {
    const release = block(template, 'release', template.indexOf('buildTypes {'));
    expect(release).toMatch(/signingConfig signingConfigs\.debug/);
  });

  const out = addReleaseSigning(template);

  it('adds a release signing config that reads only the environment', () => {
    const signing = block(out, 'signingConfigs');
    expect(signing).toContain(MARKER);
    const release = block(signing, 'release');
    expect(release).toContain("storeFile file(System.getenv('MILEWAGE_KEYSTORE_PATH'))");
    expect(release).toContain("storePassword System.getenv('MILEWAGE_KEYSTORE_PASSWORD')");
    expect(release).toContain("keyAlias System.getenv('MILEWAGE_KEY_ALIAS')");
    expect(release).toContain("keyPassword System.getenv('MILEWAGE_KEY_PASSWORD')");
    // Only defined when the key is there, so a dev machine without it still configures.
    expect(signing).toMatch(/if \(System\.getenv\('MILEWAGE_KEYSTORE_PATH'\)\) \{\s*release \{/);
    // The debug config is untouched.
    expect(block(signing, 'debug')).toBe(block(block(template, 'signingConfigs'), 'debug'));
  });

  it('the release build type uses it, falling back to the debug key when unset', () => {
    const types = block(out, 'buildTypes');
    expect(block(types, 'release')).toContain(RELEASE_USES);
    expect(block(types, 'release')).not.toMatch(/signingConfig signingConfigs\.debug/);
    expect(RELEASE_USES).toBe(
      "signingConfig System.getenv('MILEWAGE_KEYSTORE_PATH') ? signingConfigs.release : signingConfigs.debug",
    );
    expect(block(types, 'debug')).toMatch(/signingConfig signingConfigs\.debug/);
  });

  it('changes nothing else and is idempotent', () => {
    expect(addReleaseSigning(out)).toBe(out);
    const undone = out
      .replace(RELEASE_CONFIG + '\n', '')
      .replace(RELEASE_USES, 'signingConfig signingConfigs.debug');
    expect(undone).toBe(template);
  });

  it('fails loudly when the template no longer has the expected shape', () => {
    expect(() => addReleaseSigning('android {\n}\n')).toThrow(/signingConfigs/);
    const noDebugRelease = template.replace(
      block(template, 'release', template.indexOf('buildTypes {')),
      'release {\n        }',
    );
    expect(() => addReleaseSigning(noDebugRelease)).toThrow(/release build type/);
  });

  it('the config plugin rewrites build.gradle and refuses Kotlin DSL', () => {
    const cfg = withReleaseSigning({ modResults: { language: 'groovy', contents: template } });
    expect(cfg.modResults.contents).toBe(out);
    expect(() => withReleaseSigning({ modResults: { language: 'kt', contents: '' } })).toThrow(
      /Groovy/,
    );
  });

  it('app.config.js applies the plugin', () => {
    expect(require('../app.config.js').expo.plugins).toContain('./plugins/withReleaseSigning');
  });
});
