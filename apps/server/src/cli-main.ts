import { runCli } from './cli';

// Process entry of `milewage-cli` (bundled to cli.mjs by `npm run build:server`).
process.exitCode = runCli(process.argv.slice(2), process.env, {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
});
