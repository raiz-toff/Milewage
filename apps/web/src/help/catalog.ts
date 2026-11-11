import GithubSlugger from 'github-slugger';
import type { Modules } from '../api/client';

/**
 * The Help catalog (ADR 0001): every page of `docs/help/*.md` plus What's new, checked and in
 * order. Pure: `content.ts` hands it the files, the tests hand it their own.
 */

export type HelpGroup = 'start' | 'using' | 'problems' | 'reference';

export const GROUPS: { id: HelpGroup; label: string }[] = [
  { id: 'start', label: 'Start here' },
  { id: 'using', label: 'Using MileWage' },
  { id: 'problems', label: 'When something goes wrong' },
  { id: 'reference', label: 'Reference' },
];

/** A `Modules` key whose value is a boolean: what a page's `module` may name. */
export type BooleanModule = {
  [K in keyof Modules]-?: Modules[K] extends boolean ? K : never;
}[keyof Modules];

// Every boolean module, once: the compiler fails when the contract gains or loses one.
const MODULES: Record<BooleanModule, true> = {
  notifications: true,
  import: true,
  maintenance: true,
  analytics: true,
  goals: true,
  tax: true,
  receipts: true,
  expenses: true,
  earnings: true,
  platforms: true,
  devices: true,
  tracking: true,
  replay: true,
  stops: true,
  sync: true,
  diagnostics: true,
  capture: true,
  mcp: true,
  backup_download: true,
};

export interface HelpHeading {
  depth: 2 | 3;
  text: string;
  /** GitHub's anchor for the heading (github-slugger), the id rehype-slug gives it. */
  id: string;
}

export interface HelpPage {
  /** File name without .md; `whats-new` for the changelog page. */
  slug: string;
  /** The single `# ` heading; "What's new in MileWage <version>" for the changelog page. */
  title: string;
  /** One sentence, 1 to 160 characters. */
  summary: string;
  group: HelpGroup;
  /** Unique in its group. */
  order: number;
  /** The page is hidden while this module is off. */
  module: BooleanModule | null;
  /** Markdown without the frontmatter and without the `# ` title line. */
  body: string;
  headings: HelpHeading[];
  /** Repository path: `docs/help/faq.md` or `CHANGELOG.md`. */
  source: string;
}

export interface HelpCatalog {
  version: string;
  /** In group order, then by `order`. */
  pages: HelpPage[];
}

export const WHATS_NEW = 'whats-new';
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KEYS = ['summary', 'group', 'order', 'module'] as const;
type Key = (typeof KEYS)[number];
const MAX_SUMMARY = 160;

const fence = /^ {0,3}(```|~~~)/;

/** The lines of `text` with whether each sits inside a fenced code block. */
function linesOf(text: string): { line: string; code: boolean }[] {
  let open = false;
  return text.split('\n').map((line) => {
    if (fence.test(line)) {
      open = !open;
      return { line, code: true };
    }
    return { line, code: open };
  });
}

/**
 * The frontmatter, a restricted subset of YAML: the file starts with a `---` line, then
 * `key: value` lines (plain text, text in double quotes, or an integer), then `---`. Anything
 * else (comments, nesting, lists, other quoting) is a problem, so what GitHub and editors read
 * as YAML is exactly what the app reads.
 */
export function parseFrontmatter(text: string): {
  fields: Partial<Record<Key, string | number>>;
  rest: string;
  problems: string[];
} {
  const lines = text.split('\n');
  const problems: string[] = [];
  const fields: Partial<Record<Key, string | number>> = {};
  if (lines[0] !== '---')
    return { fields, rest: text, problems: ['no frontmatter: the file must start with "---"'] };
  const end = lines.indexOf('---', 1);
  if (end < 0) return { fields, rest: text, problems: ['the frontmatter has no closing "---"'] };
  for (let i = 1; i < end; i++) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    const m = /^([a-z_]+): (.*)$/.exec(line);
    if (!m) {
      problems.push(`frontmatter line ${i + 1} is not "key: value": ${line}`);
      continue;
    }
    const key = m[1]!;
    const raw = m[2]!.trim();
    if (!(KEYS as readonly string[]).includes(key)) {
      problems.push(`unknown frontmatter key "${key}"`);
      continue;
    }
    if (key in fields) {
      problems.push(`duplicate frontmatter key "${key}"`);
      continue;
    }
    const quoted = /^"([^"\\]*)"$/.exec(raw);
    if (quoted) fields[key as Key] = quoted[1]!;
    else if (/^-?\d+$/.test(raw)) fields[key as Key] = Number(raw);
    else if (raw === '' || /^[-'"[\]{}#&*!|>%@`?,]/.test(raw) || / #|: /.test(raw))
      problems.push(`frontmatter "${key}" needs plain text or "double quotes"`);
    else fields[key as Key] = raw;
  }
  return { fields, rest: lines.slice(end + 1).join('\n'), problems };
}

/** The `# ` title line (the first line with text after the frontmatter) and the body after it. */
export function splitTitle(rest: string): { title: string | null; body: string } {
  const lines = rest.split('\n');
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === '') i++;
  const m = /^# (.+)$/.exec(lines[i] ?? '');
  if (!m) return { title: null, body: rest };
  return {
    title: m[1]!.trim(),
    body: lines
      .slice(i + 1)
      .join('\n')
      .replace(/^\n+/, ''),
  };
}

/** A heading's text as it renders: link text, code text, no emphasis markers or escapes. */
function plainText(md: string): string {
  return md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/\*(\S(?:.*?\S)?)\*/g, '$1')
    .replace(/(^|\W)_(\S(?:.*?\S)?)_(?=\W|$)/g, '$1$2')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .trim();
}

/**
 * The `##` and `###` headings of a body with GitHub's anchors. Every heading is counted, so a
 * repeated heading gets `-1` as on GitHub and as rehype-slug does on the rendered page.
 */
export function headingsOf(body: string): HelpHeading[] {
  return everyHeading(body).filter((h): h is HelpHeading => h.depth === 2 || h.depth === 3);
}

/** Every heading's anchor in a Markdown file, in order, as GitHub makes them. */
export const anchorsOf = (markdown: string) => everyHeading(markdown).map((h) => h.id);

function everyHeading(markdown: string): { depth: number; text: string; id: string }[] {
  const slugger = new GithubSlugger();
  const out: { depth: number; text: string; id: string }[] = [];
  for (const { line, code } of linesOf(markdown)) {
    if (code) continue;
    const m = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (!m) continue;
    const text = plainText(m[2]!);
    out.push({ depth: m[1]!.length, text, id: slugger.slug(text) });
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The section of a Keep a Changelog file for `version`: from `## [version]` up to the next `## `,
 * its `###` headings raised to `##` so they make the page's contents. '' when there is none.
 */
export function changelogSection(text: string, version: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const head = new RegExp(`^## \\[${escape(version)}\\](?:\\s|$)`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return '';
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return linesOf(lines.slice(start + 1, end).join('\n'))
    .map(({ line, code }) => (code ? line : line.replace(/^#(#{2,5}) /, '$1 ')))
    .join('\n')
    .trim();
}

const slugOf = (path: string) => path.replace(/^.*\//, '').replace(/\.md$/, '');

/**
 * Checks and orders every page. Throws one Error that lists every problem with its file, so a
 * broken page fails the guard test in `verify` (and, were it ever built, the Help screen's error
 * boundary) rather than showing half a catalog. `README.md` is the GitHub index, not a page.
 */
export function buildCatalog(input: {
  files: Record<string, string>;
  changelog: string;
  version: string;
}): HelpCatalog {
  const problems: string[] = [];
  const pages: HelpPage[] = [];
  for (const [source, raw] of Object.entries(input.files)) {
    if (!source.endsWith('.md') || slugOf(source) === 'README') continue;
    const say = (p: string) => problems.push(`${source}: ${p}`);
    const slug = slugOf(source);
    if (slug === WHATS_NEW) say(`"${WHATS_NEW}" is kept for the What's new page`);
    else if (!SLUG.test(slug)) say('the file name must be lower-case words joined by "-"');
    const front = parseFrontmatter(raw.replace(/\r\n/g, '\n'));
    front.problems.forEach(say);
    const { summary, group, order, module } = front.fields;
    for (const k of ['summary', 'group', 'order'] as const)
      if (front.problems.length === 0 && front.fields[k] === undefined)
        say(`missing frontmatter key "${k}"`);
    if (summary !== undefined) {
      if (typeof summary !== 'string' || summary.trim() === '')
        say('"summary" must be one sentence');
      else if (summary.length > MAX_SUMMARY)
        say(`"summary" is ${summary.length} characters; at most ${MAX_SUMMARY}`);
    }
    if (group !== undefined && !GROUPS.some((g) => g.id === group))
      say(`"group" must be one of ${GROUPS.map((g) => g.id).join(', ')}`);
    if (order !== undefined && !Number.isInteger(order)) say('"order" must be an integer');
    if (module !== undefined && !(typeof module === 'string' && Object.hasOwn(MODULES, module)))
      say(`"module" must name a module that is on or off, not "${String(module)}"`);
    const { title, body } = splitTitle(front.rest);
    if (title === null) say('no "# Title" line after the frontmatter');
    if (linesOf(body).some(({ line, code }) => !code && /^# /.test(line)))
      say('a second "# " title; a page has one');
    pages.push({
      slug,
      title: title ?? slug,
      summary: typeof summary === 'string' ? summary : '',
      group: group as HelpGroup,
      order: order as number,
      module: (module as BooleanModule | undefined) ?? null,
      body,
      headings: headingsOf(body),
      source,
    });
  }
  const whatsNew = changelogSection(input.changelog, input.version);
  pages.push({
    slug: WHATS_NEW,
    title: `What's new in MileWage ${input.version}`,
    summary: 'What changed in this version.',
    group: 'reference',
    order: 10,
    module: null,
    body: whatsNew,
    headings: headingsOf(whatsNew),
    source: 'CHANGELOG.md',
  });
  const seen = new Map<string, string>();
  for (const p of pages) {
    const key = `${p.group} ${p.order}`;
    const other = seen.get(key);
    if (other && Number.isInteger(p.order))
      problems.push(`${p.source}: "order" ${p.order} is taken in "${p.group}" by ${other}`);
    seen.set(key, p.source);
  }
  if (problems.length > 0)
    throw new Error(`Help pages are not valid:\n${problems.map((p) => `- ${p}`).join('\n')}`);
  const rank = (g: HelpGroup) => GROUPS.findIndex((x) => x.id === g);
  pages.sort((a, b) => rank(a.group) - rank(b.group) || a.order - b.order);
  return { version: input.version, pages };
}

/** The page with this slug among `pages`, or null. */
export const pageOf = (pages: readonly HelpPage[], slug: string | undefined) =>
  pages.find((p) => p.slug === slug) ?? null;
