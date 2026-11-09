import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { version } from '../package.json';
import { anchorsOf, buildCatalog, changelogSection, GROUPS } from '../src/help/catalog';
import { SOURCE_URL } from '../src/help/source';

// The content guard (ADR 0001): the real docs/help pages, checked in `verify` with the module's
// own parser, so a broken page or link fails here before it reaches a driver.

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const HELP = 'docs/help';
const files = Object.fromEntries(
  readdirSync(join(ROOT, HELP))
    .filter((f) => f.endsWith('.md'))
    .map((f) => [`${HELP}/${f}`, read(`${HELP}/${f}`)]),
);
const changelog = read('CHANGELOG.md');
const catalog = buildCatalog({ files, changelog, version });
const pages = catalog.pages.filter((p) => p.slug !== 'whats-new');

/** The page's text outside code fences and inline code, where Markdown syntax means something. */
const prose = (body: string) => {
  let open = false;
  return body
    .split('\n')
    .filter((line) => {
      if (/^ {0,3}(```|~~~)/.test(line)) open = !open;
      return !open && !/^ {0,3}(```|~~~)/.test(line);
    })
    .map((line) => line.replace(/`[^`]*`/g, '``'))
    .join('\n');
};
const linksOf = (body: string) =>
  [...prose(body).matchAll(/(!?)\[[^\]]*\]\(([^)\s]*)[^)]*\)/g)].map((m) => ({
    image: m[1] === '!',
    href: m[2]!,
  }));

describe('docs/help', () => {
  it('builds a catalog from the real pages, the changelog and the web version', () => {
    expect(pages.length).toBeGreaterThanOrEqual(6);
    expect(catalog.pages.at(-1)?.slug).not.toBe(undefined);
  });

  it('every link resolves: to a page and one of its headings, or to a file in the repository', () => {
    const bad: string[] = [];
    for (const page of pages) {
      const anchors = anchorsOf(page.body);
      for (const { image, href } of linksOf(page.body)) {
        const at = `${page.source}: ${href}`;
        if (image) bad.push(`${at} (an image; v1 has none)`);
        else if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
          if (!/^(https?|mailto):/i.test(href)) bad.push(`${at} (scheme)`);
        } else if (href.startsWith('/')) bad.push(`${at} (an app path breaks on GitHub)`);
        else if (href.startsWith('#')) {
          if (!anchors.includes(href.slice(1))) bad.push(`${at} (no such heading)`);
        } else {
          const [path, hash] = href.split('#') as [string, string | undefined];
          const target = normalize(join(dirname(page.source), path));
          if (
            relative(ROOT, join(ROOT, target)).startsWith('..') ||
            !existsSync(join(ROOT, target))
          )
            bad.push(`${at} (no such file)`);
          else if (hash !== undefined) {
            const other = pages.find((p) => p.source === target);
            const ids = other ? anchorsOf(other.body) : anchorsOf(read(target));
            if (!ids.includes(hash)) bad.push(`${at} (no such heading in ${target})`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('has no raw HTML outside code, and no heading that repeats the title (GitHub would number it)', () => {
    for (const page of pages) {
      expect(prose(page.body), page.source).not.toMatch(/<[a-zA-Z/!]/);
      const title = anchorsOf(`# ${page.title}`)[0];
      expect(anchorsOf(page.body), page.source).not.toContain(title);
    }
  });

  it('README.md lists exactly the bundled pages, in order, under the group headings', () => {
    const want = GROUPS.flatMap((g) => {
      const inGroup = catalog.pages.filter((p) => p.group === g.id);
      if (inGroup.length === 0) return [];
      return [
        `## ${g.label}`,
        ...inGroup.map((p) =>
          p.slug === 'whats-new'
            ? "- [What's new](../../CHANGELOG.md): what changed in each version."
            : `- [${p.title}](${p.slug}.md): ${p.summary}`,
        ),
      ];
    });
    const have = read(`${HELP}/README.md`)
      .split('\n')
      .filter((l) => l.startsWith('## ') || l.startsWith('- ['));
    expect(have).toEqual(want);
  });

  it('CHANGELOG.md has a section for the version that is built', () => {
    expect(changelogSection(changelog, version), `## [${version}]`).not.toBe('');
  });

  it('every <HelpLink page="..."> in the web app names a page', () => {
    const src = join(ROOT, 'apps/web/src');
    const named = readdirSync(src, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.tsx'))
      .flatMap((f) =>
        [...readFileSync(join(src, f), 'utf8').matchAll(/<HelpLink\s+page="([^"]*)"/g)].map(
          (m) => ({ file: f, page: m[1]! }),
        ),
      );
    expect(named.length).toBeGreaterThanOrEqual(5);
    const slugs = catalog.pages.map((p) => p.slug);
    for (const { file, page } of named) expect(slugs, `${file}: ${page}`).toContain(page);
  });

  it("the source address in the app is the project's address in README.md", () => {
    expect(read('README.md')).toContain(SOURCE_URL);
  });
});
