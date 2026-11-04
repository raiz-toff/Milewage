import { startServer } from './start';

// Process entry for the container image (bundled by `npm run build:server`).
const server = await startServer(process.env);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void server.fastify.close().then(() => process.exit(0));
  });
}
