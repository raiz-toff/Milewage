import { SOURCE_URL } from './source';

/** Where a link in a Help page goes. */
export type ResolvedLink =
  /** `#anchor`: a heading of the same page. */
  | { kind: 'anchor'; href: string }
  /** Another Help page, inside the app. */
  | { kind: 'page'; to: string }
  /** A web address, or another repository file on GitHub at the running version's tag. */
  | { kind: 'external'; href: string }
  /** Not a link here: an app path (broken on GitHub), another scheme, or outside the repository. */
  | { kind: 'text' };

const TEXT: ResolvedLink = { kind: 'text' };

/** `a/b/../c` → `a/c`; null when the path climbs out of the repository. */
function normalise(path: string): string | null {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join('/') + (path.endsWith('/') && out.length > 0 ? '/' : '');
}

/**
 * The rule of every link in a Help page (spec Q13). Written for GitHub, where the source is read
 * as is; in the app a link to another page stays in the app, and a link to any other repository
 * file opens that file on GitHub at `v<version>`, so the driver reads it at the version they run.
 * `sourcePath` is the page's repository path (`docs/help/faq.md`, `CHANGELOG.md`); `slugs` are
 * the pages the driver can read now, so a link to a page whose module is off is plain text.
 */
export function resolveLink(
  href: string,
  sourcePath: string,
  slugs: readonly string[],
  version: string,
): ResolvedLink {
  if (href === '') return TEXT;
  if (href.startsWith('#')) return { kind: 'anchor', href };
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href);
  if (scheme)
    return ['http', 'https', 'mailto'].includes(scheme[1]!.toLowerCase())
      ? { kind: 'external', href }
      : TEXT;
  if (href.startsWith('/') || href.startsWith('\\')) return TEXT;
  const cut = href.search(/[?#]/);
  const path = cut < 0 ? href : href.slice(0, cut);
  const tail = cut < 0 ? '' : href.slice(cut);
  if (path === '') return TEXT;
  const dir = sourcePath.includes('/') ? sourcePath.replace(/\/[^/]*$/, '/') : '';
  const target = normalise(dir + path);
  if (target === null || target === '') return TEXT;
  const page = /^docs\/help\/([^/]+)\.md$/.exec(target)?.[1];
  if (page !== undefined && page !== 'README') {
    // A page that is not shown (its module is off) is plain text: no dead end, no hint.
    if (!slugs.includes(page)) return TEXT;
    const hash = tail.includes('#') ? tail.slice(tail.indexOf('#')) : '';
    return { kind: 'page', to: `/help/${page}${hash}` };
  }
  return { kind: 'external', href: `${SOURCE_URL}/blob/v${version}/${target}${tail}` };
}
