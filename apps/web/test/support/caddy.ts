import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const caddyfile = readFileSync(
  join(import.meta.dirname, '../../../../infra/docker/Caddyfile'),
  'utf8',
);

/** Every path a Caddy `path` matcher or `handle <path>` names. */
function caddyPaths(): string[] {
  const named = [...caddyfile.matchAll(/^\s*@\w+ path (.+)$/gm)].flatMap((m) =>
    m[1]!.trim().split(/\s+/),
  );
  const direct = [...caddyfile.matchAll(/^\s*handle (\/\S+) \{$/gm)].map((m) => m[1]!);
  return [...named, ...direct];
}

/** Whether Caddy has a route for `path` (else it answers 404). */
export const servedByCaddy = (path: string) =>
  caddyPaths().some((p) => (p.endsWith('/*') ? path.startsWith(p.slice(0, -1)) : p === path));

/** The body of the `handle` that serves `path`: `handle <path> { … }`, or a named matcher's. */
export function handleBlock(path: string): string {
  const named = [...caddyfile.matchAll(/^\s*@(\w+) path (.+)$/gm)].find((m) =>
    m[2]!.trim().split(/\s+/).includes(path),
  )?.[1];
  // Every regex metacharacter, not only the dot: a path is data, not a pattern.
  const head = named ? `@${named}` : path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`handle ${head} \\{([\\s\\S]*?)\\n\\t\\}`).exec(caddyfile)?.[1] ?? '';
}

/** Files under `dir` as site paths (`/icons/icon-192.png`). */
export function sitePaths(dir: string): string[] {
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((name) => {
      const full = join(d, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  return walk(dir).map((f) => `/${relative(dir, f).split('\\').join('/')}`);
}
