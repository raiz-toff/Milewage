// The shape of .github/workflows/verify.yml and release.yml: what runs, when, and on which Node.
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, test } from 'vitest';

const wf = parse(readFileSync(new URL('../.github/workflows/verify.yml', import.meta.url), 'utf8'));
const rel = parse(
  readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'),
);

describe('.github/workflows/verify.yml', () => {
  test('runs on every pull request and on pushes to main only', () => {
    expect(Object.keys(wf.on).sort()).toEqual(['pull_request', 'push']);
    expect(wf.on.push).toEqual({ branches: ['main'] });
  });

  test('the token can only read the repository', () => {
    expect(wf.permissions).toEqual({ contents: 'read' });
  });

  test('verify installs from the lockfile on the Node of .nvmrc and runs the JavaScript half', () => {
    const job = wf.jobs.verify;
    const setup = job.steps.find((s) => String(s.uses ?? '').startsWith('actions/setup-node@'));
    expect(setup.with).toEqual({ 'node-version-file': '.nvmrc', cache: 'npm' });
    expect(job.steps.map((s) => s.run).filter(Boolean)).toEqual([
      'node -v',
      'npm ci',
      'npm run verify:js',
    ]);
    expect(job['continue-on-error']).toBeUndefined();
    expect(job['timeout-minutes']).toBeGreaterThanOrEqual(20);
  });

  test('the two jobs together run the whole contract: npm run verify is verify:js then verify:android', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.scripts.verify).toBe('npm run verify:js && npm run verify:android');
    expect(pkg.scripts['verify:android']).toBe('bash scripts/verify-android.sh');
    const runs = wf.jobs.android.steps.map((s) => s.run).filter(Boolean);
    expect(runs.some((r) => r.startsWith('bash scripts/verify-android.sh'))).toBe(true);
    expect(runs.find((r) => r.startsWith('bash scripts/verify-android.sh'))).toContain(
      'assembleDebug',
    );
  });

  test('the Android job: JDK 17, Gradle caching, the SDK platform, artifacts, no signing secrets', () => {
    const job = wf.jobs.android;
    const uses = job.steps.map((s) => String(s.uses ?? '')).filter(Boolean);
    const java = job.steps.find((s) => String(s.uses ?? '').startsWith('actions/setup-java@'));
    expect(java.with).toEqual({ distribution: 'temurin', 'java-version': '17' });
    expect(uses.some((u) => u.startsWith('gradle/actions/setup-gradle@'))).toBe(true);
    expect(job.steps.map((s) => s.run ?? '').join('\n')).toContain('platforms;android-37.0');
    const upload = job.steps.find((s) =>
      String(s.uses ?? '').startsWith('actions/upload-artifact@'),
    );
    expect(upload.with.path).toContain('app-debug.apk');
    // Every action is pinned to a version tag, as the rest of the file.
    for (const u of uses) expect(u).toMatch(/@v\d+$/);
    // The upload key never reaches CI: nothing here reads a secret.
    expect(JSON.stringify(job)).not.toMatch(/secrets\.|MILEWAGE_KEY/);
    expect(job['timeout-minutes']).toBeGreaterThanOrEqual(30);
  });

  test('the audit checks production dependencies for high and critical only, and does not block yet', () => {
    const job = wf.jobs.audit;
    expect(job['continue-on-error']).toBe(true);
    expect(job.steps.at(-1).run).toBe('npm audit --omit=dev --audit-level=high');
  });

  test('a newer push to the same branch cancels the older run', () => {
    expect(wf.concurrency).toEqual({
      group: 'verify-${{ github.ref }}',
      'cancel-in-progress': true,
    });
  });
});

describe('.github/workflows/release.yml', () => {
  test('runs on v* tags, or by hand with a tag name', () => {
    expect(rel.on.push).toEqual({ tags: ['v*'] });
    expect(rel.on.workflow_dispatch.inputs.tag.required).toBe(true);
  });

  test('may write packages and only read the repository', () => {
    expect(rel.permissions).toEqual({ contents: 'read', packages: 'write' });
  });

  test('checks the tag against VERSION, then pushes both images for amd64 and arm64 to ghcr.io', () => {
    const steps = rel.jobs.images.steps;
    expect(steps.find((s) => s.name === 'The tag must be the VERSION file').run).toMatch(/VERSION/);
    const login = steps.find((s) => String(s.uses ?? '').startsWith('docker/login-action@'));
    expect(login.with.registry).toBe('ghcr.io');
    const builds = steps.filter((s) =>
      String(s.uses ?? '').startsWith('docker/build-push-action@'),
    );
    expect(builds).toHaveLength(2);
    for (const b of builds) {
      expect(b.with.file).toBe('infra/docker/Dockerfile');
      expect(b.with.platforms).toBe('linux/amd64,linux/arm64');
      expect(b.with.push).toBe(true);
      expect(b.with.labels).toContain('org.opencontainers.image.source=');
    }
    expect(builds[0].with.target).toBeUndefined();
    expect(builds[0].with.tags).toContain('/server:${{ env.TAG }}');
    expect(builds[0].with.tags).toContain('/server:latest');
    expect(builds[1].with.target).toBe('caddy');
    expect(builds[1].with.tags).toContain('/caddy:${{ env.TAG }}');
    expect(builds[1].with.tags).toContain('/caddy:latest');
    expect(rel.jobs.images.env.IMAGE_REPO).toBe('ghcr.io/${{ github.repository_owner }}/milewage');
  });

  test('builds no APK: the signed app is built on the owner’s machine and attached by hand', () => {
    expect(Object.keys(rel.jobs)).toEqual(['images']);
    expect(JSON.stringify(rel)).not.toMatch(/gradlew|assembleRelease|MILEWAGE_KEY/);
  });
});
