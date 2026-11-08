import { createInterface } from 'node:readline/promises';
import { runCli } from './cli';

// Process entry of `milewage-cli` (bundled to cli.mjs by `npm run build:server`).
process.exitCode = await runCli(process.argv.slice(2), process.env, {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  async ask(question) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    // A closed stdin (no terminal, nothing piped) answers with an empty line instead of hanging.
    const closed = new Promise<string>((resolve) => rl.once('close', () => resolve('')));
    try {
      return await Promise.race([rl.question(question), closed]);
    } finally {
      rl.close();
    }
  },
});
