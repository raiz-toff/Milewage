import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// Decision 1.10 removed the live module, and with it the WebSocket server.
test('the server does not declare the ws packages', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  expect(declared).not.toContain('ws');
  expect(declared).not.toContain('@types/ws');
});
