// The shape of .github/workflows/verify.yml: what runs, when, and on which Node.
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, test } from 'vitest';

const wf = parse(readFileSync(new URL('../.github/workflows/verify.yml', import.meta.url), 'utf8'));

describe('.github/workflows/verify.yml', () => {
  test('runs on every pull request and on pushes to main only', () => {
    expect(Object.keys(wf.on).sort()).toEqual(['pull_request', 'push']);
    expect(wf.on.push).toEqual({ branches: ['main'] });
  });

  test('the token can only read the repository', () => {
    expect(wf.permissions).toEqual({ contents: 'read' });
  });

  test('verify installs from the lockfile on the Node of .nvmrc and runs the contract', () => {
    const job = wf.jobs.verify;
    const setup = job.steps.find((s) => String(s.uses ?? '').startsWith('actions/setup-node@'));
    expect(setup.with).toEqual({ 'node-version-file': '.nvmrc', cache: 'npm' });
    expect(job.steps.map((s) => s.run).filter(Boolean)).toEqual([
      'node -v',
      'npm ci',
      'npm run verify',
    ]);
    expect(job['continue-on-error']).toBeUndefined();
    expect(job['timeout-minutes']).toBeGreaterThanOrEqual(20);
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
