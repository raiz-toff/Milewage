#!/usr/bin/env node
// `npm run dev`: builds the server bundle, starts the API on 127.0.0.1:3000 with its data in .dev/
// (kept across restarts, ignored by git), and the web dev server that proxies /api to it.
// MILEWAGE_DEV_PORT moves the API to another port when 3000 is taken on this machine.
// Ctrl-C stops both. With `npm run dev -- --host` (Vite on the LAN) the API is also given its home
// address and the server is announced on the Wi-Fi (plan 28); MILEWAGE_LAN_DISCOVERY=0 turns it off.
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from './build-server.mjs';
import { devLan } from './lan.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dev = join(root, '.dev');
const apiPort = process.env.MILEWAGE_DEV_PORT ?? '3000';

await buildServer();
const lan = devLan(process.argv.slice(2), process.env, networkInterfaces());

const children = [
  spawn(process.execPath, [join(root, 'dist/server.mjs')], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      MILEWAGE_PORT: apiPort,
      MILEWAGE_HOST: '127.0.0.1',
      MILEWAGE_DATA_DIR: join(dev, 'data'),
      MILEWAGE_CONFIG_DIR: join(dev, 'config'),
      MILEWAGE_BACKUP_DIR: join(dev, 'backups'),
      MILEWAGE_LOG_LEVEL: process.env.MILEWAGE_LOG_LEVEL ?? 'warn',
      ...(lan ? { MILEWAGE_HOME_URL: lan.homeUrl } : {}),
    },
  }),
  spawn('npm', ['run', 'dev', '-w', 'apps/web', '--', ...process.argv.slice(2)], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, MILEWAGE_DEV_API: `http://127.0.0.1:${apiPort}` },
  }),
];
if (lan) {
  console.log(`Home address for phones: ${lan.homeUrl} (announced on the Wi-Fi as _milewage._tcp)`);
  children.push(
    spawn(process.execPath, [join(root, 'dist/advertise.mjs')], {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        MILEWAGE_ADVERTISE_PORT: String(lan.port),
        MILEWAGE_HEALTH_URL: `http://127.0.0.1:${apiPort}/healthz`,
      },
    }),
  );
}

const stop = () => children.forEach((c) => c.exitCode === null && c.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
// If any process dies, take the others down too so a dead API never hides behind a live UI.
for (const c of children) c.on('exit', stop);
