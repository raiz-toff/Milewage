import changelog from '../../../../CHANGELOG.md?raw';
import { buildCatalog } from './catalog';
import { HELP_VERSION } from './source';

/**
 * The only file that reaches outside the web app (ADR 0001): every page of `docs/help/` and the
 * changelog, inlined into this lazy chunk by Vite at build time. Nothing is fetched; the pages
 * are the ones of the tree that was built.
 */
// README.md is the GitHub index of the folder, not a page.
const raw = import.meta.glob<string>(['../../../../docs/help/*.md', '!**/README.md'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

// Glob keys are relative to this file; the catalog works with repository paths.
const files = Object.fromEntries(
  Object.entries(raw).map(([key, text]) => [key.replace(/^(\.\.\/)+/, ''), text]),
);

export const catalog = buildCatalog({ files, changelog, version: HELP_VERSION });
