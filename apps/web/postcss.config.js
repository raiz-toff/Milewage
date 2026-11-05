import { join } from 'node:path';

// The Tailwind config is named by path so a build started from another directory (the test run
// starts at the repository root) finds it too.
export default {
  plugins: {
    tailwindcss: { config: join(import.meta.dirname, 'tailwind.config.ts') },
    autoprefixer: {},
  },
};
