#!/usr/bin/env node
// `npm run dev`: builds the server bundle, starts the API on 127.0.0.1:3000 with its data in .dev/
// (kept across restarts, ignored by git), and the web dev server that proxies /api to it.
// Ctrl-C stops both.
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from './build-server.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dev = join(root, '.dev');

await buildServer();

const children = [
  spawn(process.execPath, [join(root, 'dist/server.mjs')], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      MILEWAGE_PORT: '3000',
      MILEWAGE_HOST: '127.0.0.1',
      MILEWAGE_DATA_DIR: join(dev, 'data'),
      MILEWAGE_CONFIG_DIR: join(dev, 'config'),
      MILEWAGE_BACKUP_DIR: join(dev, 'backups'),
      MILEWAGE_LOG_LEVEL: process.env.MILEWAGE_LOG_LEVEL ?? 'warn',
    },
  }),
  spawn('npm', ['run', 'dev', '-w', 'apps/web', '--', ...process.argv.slice(2)], {
    cwd: root,
    stdio: 'inherit',
  }),
];

const stop = () => children.forEach((c) => c.exitCode === null && c.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
// If either process dies, take the other down too so a dead API never hides behind a live UI.
for (const c of children) c.on('exit', stop);
