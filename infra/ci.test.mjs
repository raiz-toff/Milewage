// The shape of .gitlab-ci.yml: which jobs run, in which stage, and when.
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';

const ci = parse(readFileSync(new URL('../.gitlab-ci.yml', import.meta.url), 'utf8'));
const ifs = (job) => (job.rules ?? []).map((r) => r.if);
const TAG = '$CI_COMMIT_TAG =~ /^v/';

describe('.gitlab-ci.yml', () => {
  test('declares the stages and exactly the four jobs', () => {
    expect(ci.stages).toEqual(['test', 'build']);
    const jobs = Object.keys(ci).filter((k) => k !== 'stages' && !k.startsWith('.'));
    expect(jobs.sort()).toEqual(['audit', 'images', 'phone-apk', 'verify']);
    for (const name of jobs) expect(ci.stages).toContain(ci[name].stage);
  });

  test('verify still runs npm run verify on merge requests, the default branch and tags', () => {
    expect(ci.verify.stage).toBe('test');
    expect(ci.verify.image).toBe('node:22.22.0-bookworm-slim');
    expect(ci.verify.script).toContain('npm run verify');
    expect(ci.verify.allow_failure).toBeUndefined();
    expect(ifs(ci.verify)).toEqual([
      '$CI_PIPELINE_SOURCE == "merge_request_event"',
      '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH',
      TAG,
    ]);
  });

  test('audit checks production dependencies for high issues and does not block yet', () => {
    expect(ci.audit.stage).toBe('test');
    expect(ci.audit.script).toEqual(['npm audit --omit=dev --audit-level=high']);
    expect(ci.audit.allow_failure).toBe(true);
    expect(ifs(ci.audit)).toEqual(ifs(ci.verify));
  });

  test('images builds server and caddy for amd64 and arm64 on v* tags and pushes both tags', () => {
    const job = ci.images;
    expect(job.stage).toBe('build');
    expect(job.needs).toEqual(['verify']);
    expect(job.image).toBe('docker:27');
    expect(job.services.map((s) => s.name ?? s)).toEqual(['docker:27-dind']);
    expect(job.rules).toEqual([{ if: TAG }]);
    expect(job.variables.PLATFORMS).toBe('linux/amd64,linux/arm64');
    expect(job.before_script.join('\n')).toMatch(/docker login .*"\$CI_REGISTRY"/);
    expect(job.before_script.join('\n')).toMatch(/docker buildx create/);

    const [server, caddy] = job.script;
    for (const cmd of job.script) {
      expect(cmd).toMatch(
        /^docker buildx build --platform "\$PLATFORMS" -f infra\/docker\/Dockerfile/,
      );
      expect(cmd).toMatch(/--push \.$/);
    }
    // The server is the Dockerfile's last stage, so no --target.
    expect(server).not.toMatch(/--target/);
    expect(server).toContain('-t "$CI_REGISTRY_IMAGE/server:$CI_COMMIT_TAG"');
    expect(server).toContain('-t "$CI_REGISTRY_IMAGE/server:latest"');
    expect(caddy).toContain('--target caddy');
    expect(caddy).toContain('-t "$CI_REGISTRY_IMAGE/caddy:$CI_COMMIT_TAG"');
    expect(caddy).toContain('-t "$CI_REGISTRY_IMAGE/caddy:latest"');
  });

  test('phone-apk is a manual tag job on an android runner that keeps the APK', () => {
    const job = ci['phone-apk'];
    expect(job.stage).toBe('build');
    expect(job.tags).toEqual(['android']);
    expect(job.script[0]).toBe('scripts/phone-release-build.sh');
    expect(job.rules).toEqual([{ if: TAG, when: 'manual', allow_failure: true }]);
    expect(job.artifacts.paths).toEqual([
      'apps/phone/android/app/build/outputs/apk/release/app-release.apk',
    ]);
    expect(job.variables.MILEWAGE_VERSION_CODE).toBe('$CI_PIPELINE_IID');
  });

  test('phone-apk checks the merged release manifest after the build and fails without one', () => {
    // `verify` runs before any build, so the merged-manifest tests skip there; here they must run.
    expect(ci['phone-apk'].script).toEqual([
      'scripts/phone-release-build.sh',
      'MILEWAGE_REQUIRE_MERGED_MANIFEST=1 npm test -w apps/phone -- test/manifest.test.ts',
    ]);
    const test = readFileSync(
      new URL('../apps/phone/test/manifest.test.ts', import.meta.url),
      'utf8',
    );
    expect(test).toContain("process.env.MILEWAGE_REQUIRE_MERGED_MANIFEST === '1'");
  });

  test('the tag rule matches release tags only', () => {
    const pattern = /=~ \/(.+)\/$/.exec(ci.images.rules[0].if)[1];
    const tagMatches = (tag) => new RegExp(pattern).test(tag);
    expect(['v0.1.0', 'v1.0.0-rc.1'].every(tagMatches)).toBe(true);
    expect(['0.1.0', 'release-1', 'main'].some(tagMatches)).toBe(false);
  });
});
