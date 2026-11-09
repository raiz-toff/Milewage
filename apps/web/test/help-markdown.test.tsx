// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCatalog, changelogSection, headingsOf, parseFrontmatter } from '../src/help/catalog';
import { catalog } from '../src/help/content';
import { HelpMarkdown } from '../src/help/HelpMarkdown';
import { resolveLink } from '../src/help/links';

// Help's internal seams: the renderer, the catalog's checks, the link rule, the changelog cut.

afterEach(cleanup);

const draw = (markdown: string, source = 'docs/help/faq.md') =>
  render(
    <MemoryRouter>
      <HelpMarkdown markdown={markdown} source={source} slugs={['faq', 'tax']} version="0.1.0" />
    </MemoryRouter>,
  ).container;

describe('HelpMarkdown', () => {
  it('never renders raw HTML, images or script URLs', () => {
    const c = draw(
      [
        '<script>alert(1)</script>',
        '',
        'Text <img src=x onerror=alert(1)> here.',
        '',
        '![x](https://example.com/x.png)',
        '',
        '[x](javascript:alert(1))',
        '',
        '<div onclick="alert(1)">block</div>',
      ].join('\n'),
    );
    expect(c.querySelector('script')).toBeNull();
    expect(c.querySelector('img')).toBeNull();
    expect(c.querySelector('div[onclick]')).toBeNull();
    expect(c.innerHTML).not.toContain('onerror');
    expect(c.innerHTML).not.toContain('javascript:');
    expect(c.textContent).not.toContain('alert');
    expect(c.querySelector('a')).toBeNull(); // the emptied link is plain text
  });

  it("puts a GFM table in the app's table box, and gives headings GitHub's anchors", () => {
    const c = draw(
      '## Who can see my data?\n\n| Kind | Kept |\n| --- | --- |\n| GPS | 90 days |\n\n## Who can see my data?',
    );
    const table = c.querySelector('table')!;
    expect(table.parentElement!.className).toContain('rounded-xl border');
    expect(table.querySelectorAll('td')).toHaveLength(2);
    expect([...c.querySelectorAll('h2')].map((h) => h.id)).toEqual([
      'who-can-see-my-data',
      'who-can-see-my-data-1',
    ]);
  });

  it('keeps page links in the app and opens other files on GitHub at the version', () => {
    const c = draw('[a](tax.md#rates) [b](../../infra/docs/upgrade.md) [c](/privacy) [d](#top)');
    const hrefs = [...c.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/help/tax#rates',
      'https://github.com/raiz-toff/Milewage/blob/v0.1.0/infra/docs/upgrade.md',
      '#top',
    ]);
    expect(c.textContent).toContain('c'); // the app path stays as text
  });

  it("every page's contents list points at an id the rendered page has", () => {
    const slugs = catalog.pages.map((p) => p.slug);
    for (const page of catalog.pages) {
      const c = draw(page.body, page.source);
      const ids = new Set([...c.querySelectorAll('[id]')].map((e) => e.id));
      for (const h of page.headings) expect(ids.has(h.id), `${page.slug} #${h.id}`).toBe(true);
      expect(slugs).toContain(page.slug);
      cleanup();
    }
  });
});

const page = (front: string, body = '# Title\n\nText.') => `---\n${front}\n---\n\n${body}`;
const good = 'summary: One line.\ngroup: using\norder: 10';
const build = (files: Record<string, string>) =>
  buildCatalog({
    files,
    changelog: '## [0.1.0] - 2026-11-09\n\n### Added\n\n- A.',
    version: '0.1.0',
  });
const problemOf = (files: Record<string, string>) => {
  try {
    build(files);
  } catch (e) {
    return (e as Error).message;
  }
  return null;
};

describe('buildCatalog', () => {
  it('reads the frontmatter, the title and the body, and orders by group then order', () => {
    const { pages } = build({
      'docs/help/b.md': page('summary: B.\ngroup: using\norder: 20'),
      'docs/help/a.md': page('summary: "A: quoted."\ngroup: start\norder: 10\nmodule: tax'),
      'docs/help/c.md': page('summary: C.\ngroup: using\norder: 10', '# C page\n\n## One\n\nx'),
      'docs/help/README.md': '# Index',
    });
    expect(pages.map((p) => p.slug)).toEqual(['a', 'c', 'b', 'whats-new']);
    expect(pages[0]).toMatchObject({ title: 'Title', summary: 'A: quoted.', module: 'tax' });
    expect(pages[1]).toMatchObject({
      title: 'C page',
      body: '## One\n\nx',
      headings: [{ depth: 2, text: 'One', id: 'one' }],
      source: 'docs/help/c.md',
    });
    expect(pages[3]).toMatchObject({
      title: "What's new in MileWage 0.1.0",
      group: 'reference',
      order: 10,
      body: '## Added\n\n- A.',
      source: 'CHANGELOG.md',
    });
  });

  it.each([
    ['no frontmatter', { 'docs/help/x.md': '# Title' }, 'docs/help/x.md: no frontmatter'],
    [
      'an unknown key',
      { 'docs/help/x.md': page(`${good}\ntitle: X`) },
      'unknown frontmatter key "title"',
    ],
    [
      'a duplicate order in a group',
      { 'docs/help/x.md': page(good), 'docs/help/y.md': page(good) },
      'docs/help/y.md: "order" 10 is taken in "using" by docs/help/x.md',
    ],
    [
      'a bad group',
      { 'docs/help/x.md': page('summary: S.\ngroup: misc\norder: 1') },
      '"group" must be one of',
    ],
    [
      'a bad module',
      { 'docs/help/x.md': page(`${good}\nmodule: exporters`) },
      '"module" must name a module',
    ],
    [
      'a summary over 160 characters',
      { 'docs/help/x.md': page(`summary: ${'a'.repeat(161)}\ngroup: using\norder: 1`) },
      '"summary" is 161 characters',
    ],
    ['a missing title', { 'docs/help/x.md': page(good, 'Text only.') }, 'no "# Title" line'],
    ['two titles', { 'docs/help/x.md': page(good, '# One\n\n# Two') }, 'a second "# " title'],
    [
      'a file named whats-new.md',
      { 'docs/help/whats-new.md': page(good) },
      "kept for the What's new page",
    ],
    [
      'a missing key',
      { 'docs/help/x.md': page('summary: S.\ngroup: using') },
      'missing frontmatter key "order"',
    ],
    ['nesting', { 'docs/help/x.md': page(`${good}\n  nested: 1`) }, 'is not "key: value"'],
    ['a comment', { 'docs/help/x.md': page(`${good}\n# note`) }, 'is not "key: value"'],
    ['a capital in the name', { 'docs/help/Faq.md': page(good) }, 'lower-case words'],
  ])('rejects %s, naming the file', (_, files, message) => {
    const error = problemOf(files);
    expect(error).toContain(message);
    expect(error).toContain(Object.keys(files).at(-1)!);
  });

  it('lists every problem at once', () => {
    const error = problemOf({
      'docs/help/x.md': '# Title',
      'docs/help/y.md': page('summary: S.\ngroup: misc\norder: 1'),
    })!;
    expect(error).toContain('docs/help/x.md');
    expect(error).toContain('docs/help/y.md');
  });

  it('a "# " line inside a code fence is not a second title', () => {
    expect(
      problemOf({ 'docs/help/x.md': page(good, '# T\n\n```\n# shell comment\n```') }),
    ).toBeNull();
  });

  it('parses the frontmatter subset only', () => {
    expect(parseFrontmatter('---\nsummary: x\norder: 3\n---\n# T').fields).toEqual({
      summary: 'x',
      order: 3,
    });
    expect(parseFrontmatter("---\nsummary: 'single'\n---").problems[0]).toContain('plain text');
  });

  it('heading anchors follow GitHub: code, links and emphasis are text; repeats count', () => {
    expect(
      headingsOf('## The `raw` [map](x.md) **line**\n\n### Again\n\n## Again\n\n```\n## not\n```'),
    ).toEqual([
      { depth: 2, text: 'The raw map line', id: 'the-raw-map-line' },
      { depth: 3, text: 'Again', id: 'again' },
      { depth: 2, text: 'Again', id: 'again-1' },
    ]);
  });
});

describe('resolveLink', () => {
  const slugs = ['faq', 'tax'];
  const gh = 'https://github.com/raiz-toff/Milewage/blob/v0.1.0';
  it.each([
    ['#who', 'docs/help/faq.md', { kind: 'anchor', href: '#who' }],
    ['tax.md', 'docs/help/faq.md', { kind: 'page', to: '/help/tax' }],
    ['tax.md#rates', 'docs/help/faq.md', { kind: 'page', to: '/help/tax#rates' }],
    ['./faq.md', 'docs/help/faq.md', { kind: 'page', to: '/help/faq' }],
    ['docs/help/faq.md#x', 'CHANGELOG.md', { kind: 'page', to: '/help/faq#x' }],
    ['other.md', 'docs/help/faq.md', { kind: 'text' }],
    ['README.md', 'docs/help/faq.md', { kind: 'external', href: `${gh}/docs/help/README.md` }],
    [
      '../../infra/docs/upgrade.md#if-the-upgrade-fails',
      'docs/help/faq.md',
      { kind: 'external', href: `${gh}/infra/docs/upgrade.md#if-the-upgrade-fails` },
    ],
    ['../../LICENSE', 'docs/help/faq.md', { kind: 'external', href: `${gh}/LICENSE` }],
    ['../../../etc/passwd', 'docs/help/faq.md', { kind: 'text' }],
    ['/privacy', 'docs/help/faq.md', { kind: 'text' }],
    ['//evil.example', 'docs/help/faq.md', { kind: 'text' }],
    [
      'mailto:me@example.com',
      'docs/help/faq.md',
      { kind: 'external', href: 'mailto:me@example.com' },
    ],
    [
      'https://example.com/a',
      'docs/help/faq.md',
      { kind: 'external', href: 'https://example.com/a' },
    ],
    ['javascript:alert(1)', 'docs/help/faq.md', { kind: 'text' }],
    ['', 'docs/help/faq.md', { kind: 'text' }],
  ])('%s from %s', (href, source, expected) => {
    expect(resolveLink(href, source, slugs, '0.1.0')).toEqual(expected);
  });
});

describe('changelogSection', () => {
  const log = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '### Added',
    '',
    '- Later.',
    '',
    '## [0.1.01] - 2026-12-01',
    '',
    '- Not this one.',
    '',
    '## [0.1.0] - 2026-11-09',
    '',
    '### Not yet verified',
    '',
    '- Rates.',
    '',
    '```',
    '### kept',
    '```',
    '',
    '## [0.0.9] - 2026-10-01',
    '',
    '- Older.',
  ].join('\n');

  it("cuts the version's section up to the next one and raises its headings", () => {
    expect(changelogSection(log, '0.1.0')).toBe(
      '## Not yet verified\n\n- Rates.\n\n```\n### kept\n```',
    );
  });

  it('is empty for a version with no section, and 0.1.0 does not match 0.1.01', () => {
    expect(changelogSection(log, '9.9.9')).toBe('');
    expect(changelogSection(log, '0.1.01')).toBe('- Not this one.');
    expect(changelogSection(log, '0.0.9')).toBe('- Older.');
  });
});
