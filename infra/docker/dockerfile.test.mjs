// Base images are pinned by digest, so a rebuild of the same commit uses the same bytes.
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { expect, test } from 'vitest';

const dockerfile = readFileSync(new URL('./Dockerfile', import.meta.url), 'utf8');
const froms = [...dockerfile.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/gm)].map((m) => ({
  image: m[1],
  stage: m[2],
}));
const stages = new Set(froms.map((f) => f.stage).filter(Boolean));
const external = froms.filter((f) => !stages.has(f.image));

test('every base image from a registry is pinned by tag and sha256 digest', () => {
  expect(external.length).toBeGreaterThan(0);
  for (const { image } of external) {
    expect(image).toMatch(/^[a-z0-9./-]+:[\w.-]+@sha256:[0-9a-f]{64}$/);
  }
});

test('the pinned versions are the ones the stack is tested on, one digest per image', () => {
  const byTag = new Map();
  for (const { image } of external) {
    const [tag, digest] = image.split('@');
    if (byTag.has(tag)) expect(byTag.get(tag)).toBe(digest);
    byTag.set(tag, digest);
  }
  expect([...byTag.keys()].sort()).toEqual(['caddy:2.8.4-alpine', 'node:22.22.0-bookworm-slim']);
});

test('the server stays the last stage, so a plain build and the images job produce it', () => {
  const last = froms[froms.length - 1];
  expect(last.image).toMatch(/^node:/);
  expect(last.stage).toBeUndefined();
  expect(stages.has('caddy')).toBe(true);
});

test('the web build sees the Help pages and the changelog (ADR 0001): the context keeps them', () => {
  const ignored = readFileSync(new URL('../../.dockerignore', import.meta.url), 'utf8')
    .split('\n')
    .map((l) => l.trim().replace(/^\/|\/$/g, ''))
    .filter((l) => l && !l.startsWith('#'));
  for (const kept of [
    'docs',
    'docs/help',
    'docs/*',
    'docs/help/*',
    'CHANGELOG.md',
    '*.md',
    '**/*.md',
  ])
    expect(ignored, kept).not.toContain(kept);
  // The web stage starts from the build stage, which copied the whole context.
  expect(dockerfile).toMatch(/^FROM build AS web$/m);
  expect(dockerfile.indexOf('COPY . .')).toBeGreaterThan(-1);
  expect(dockerfile.indexOf('COPY . .')).toBeLessThan(dockerfile.indexOf('npm run build:web'));
});
