// renovate.json: valid JSON with the agreed policy (grouped minor and patch, pinned Docker digests,
// weekly). Renovate itself only reads it when a Renovate bot is pointed at the project.
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { expect, test } from 'vitest';

const text = readFileSync(new URL('../renovate.json', import.meta.url), 'utf8');

test('renovate.json is valid JSON with the expected keys and presets', () => {
  const config = JSON.parse(text);
  expect(Object.keys(config).sort()).toEqual(['$schema', 'extends', 'packageRules']);
  expect(config.$schema).toBe('https://docs.renovatebot.com/renovate-schema.json');
  expect(config.extends).toEqual(['config:recommended', 'docker:pinDigests', 'schedule:weekly']);
});

test('minor and patch updates come in one group; majors are left out of it', () => {
  const { packageRules } = JSON.parse(text);
  const group = packageRules.find((r) => r.groupName === 'minor and patch updates');
  expect(group).toBeDefined();
  expect([...group.matchUpdateTypes].sort()).toEqual(['minor', 'patch']);
  expect(
    packageRules.some((r) => (r.matchUpdateTypes ?? []).includes('major') && r.groupName),
  ).toBe(false);
});

test('the Android app’s Gradle catalog and wrapper are covered: stable only, in their own group', () => {
  const { packageRules } = JSON.parse(text);
  const android = packageRules.find((r) => (r.matchManagers ?? []).includes('gradle'));
  expect(android).toBeDefined();
  expect([...android.matchManagers].sort()).toEqual(['gradle', 'gradle-wrapper']);
  expect(android.ignoreUnstable).toBe(true);
  expect([...android.matchUpdateTypes].sort()).toEqual(['minor', 'patch']);
  expect(android.groupName).not.toBe('minor and patch updates');
  // config:recommended keeps the gradle managers on; nothing narrows enabledManagers.
  expect(JSON.parse(text).enabledManagers).toBeUndefined();
});

test('the README says Renovate only runs when a bot is pointed at the project', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  expect(readme).toMatch(/renovate\.json/);
  expect(readme).toMatch(/only when a Renovate bot/i);
});
