// docker-compose.release.yml must be docker-compose.yml with published images instead of builds.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';

const read = (name) => parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
const local = read('docker-compose.yml');
const release = read('docker-compose.release.yml');
const dir = fileURLToPath(new URL('.', import.meta.url));

/** The file without the keys that are allowed to differ (how each service gets its image). */
function withoutImages(compose) {
  const copy = JSON.parse(JSON.stringify(compose));
  for (const svc of Object.values(copy.services)) {
    delete svc.build;
    delete svc.image;
  }
  return copy;
}

describe('docker-compose.release.yml', () => {
  test('agrees with docker-compose.yml on everything but build and image', () => {
    expect(Object.keys(release.services)).toEqual(Object.keys(local.services));
    expect(withoutImages(release)).toEqual(withoutImages(local));
  });

  test('pulls from MILEWAGE_IMAGE_REPO and builds nothing', () => {
    expect(release.services.api.image).toBe(
      '${MILEWAGE_IMAGE_REPO:?set to your registry path}/server:${MILEWAGE_VERSION:-latest}',
    );
    expect(release.services.caddy.image).toBe(
      '${MILEWAGE_IMAGE_REPO:?set to your registry path}/caddy:${MILEWAGE_VERSION:-latest}',
    );
    for (const svc of Object.values(release.services)) expect(svc.build).toBeUndefined();
    for (const svc of Object.values(local.services)) expect(svc.build).toBeDefined();
  });

  // `docker compose config` resolves the file as Docker will; skipped where Docker is missing.
  const hasCompose = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
  (hasCompose ? test : test.skip)(
    'docker compose accepts it and requires MILEWAGE_IMAGE_REPO',
    () => {
      const run = (extra) =>
        spawnSync(
          'docker',
          ['compose', '-f', 'docker-compose.release.yml', 'config', '--format', 'json'],
          {
            cwd: dir,
            encoding: 'utf8',
            env: { ...process.env, MILEWAGE_IMAGE_REPO: '', ...extra },
          },
        );
      const missing = run({});
      expect(missing.status).not.toBe(0);
      expect(missing.stderr).toMatch(/set to your registry path/);
      const ok = run({
        MILEWAGE_IMAGE_REPO: 'registry.example.com/me/milewage',
        MILEWAGE_VERSION: 'v1.2.3',
      });
      expect(ok.status, ok.stderr).toBe(0);
      const services = JSON.parse(ok.stdout).services;
      expect(services.api.image).toBe('registry.example.com/me/milewage/server:v1.2.3');
      expect(services.caddy.image).toBe('registry.example.com/me/milewage/caddy:v1.2.3');
    },
  );
});
