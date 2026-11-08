#!/usr/bin/env node
// Bundles the server into dist/server.mjs. The native module stays external; dist/native-package.json
// pins its exact locked version so the image installs the same build (see infra/docker/Dockerfile).
// Usage: node scripts/build-server.mjs [outDir]
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const NATIVE = ['better-sqlite3'];
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function lockedVersion(lock, name) {
  const entry = lock.packages?.[`node_modules/${name}`];
  if (!entry?.version) throw new Error(`${name} is not in package-lock.json`);
  return entry.version;
}

export async function buildServer(outDir = join(root, 'dist')) {
  mkdirSync(outDir, { recursive: true });
  await build({
    // server.mjs is the API; cli.mjs is `milewage-cli` (10 section 7), all with the native module external.
    entryPoints: {
      server: join(root, 'apps/server/src/main.ts'),
      cli: join(root, 'apps/server/src/cli-main.ts'),
      // advertise.mjs announces the server on the home network (plan 28 section 4.6).
      advertise: join(root, 'apps/server/src/advertise-main.ts'),
    },
    outdir: outDir,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    external: NATIVE,
    // Bundled CommonJS dependencies call require(); give them one in the ESM output.
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    logLevel: 'warning',
  });
  // MIGRATIONS_DIR resolves next to the module file, which in the bundle is the output folder.
  rmSync(join(outDir, 'migrations'), { recursive: true, force: true });
  cpSync(join(root, 'apps/server/src/db/migrations'), join(outDir, 'migrations'), {
    recursive: true,
  });
  rmSync(join(outDir, 'diagnostics-migrations'), { recursive: true, force: true });
  cpSync(
    join(root, 'apps/server/src/diagnostics/diagnostics-migrations'),
    join(outDir, 'diagnostics-migrations'),
    { recursive: true },
  );
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const dependencies = Object.fromEntries(NATIVE.map((n) => [n, lockedVersion(lock, n)]));
  writeFileSync(
    join(outDir, 'native-package.json'),
    JSON.stringify({ name: 'milewage-server-runtime', private: true, dependencies }, null, 2) +
      '\n',
  );
  return { outDir, dependencies };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { outDir } = await buildServer(process.argv[2]);
  console.log(`server bundle written to ${outDir}`);
}
