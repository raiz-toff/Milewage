import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import Markdown from 'react-markdown';
import type { Components, ExtraProps } from 'react-markdown';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import { Separator } from '@/components/ui/separator';
import { TableBox, tableClass } from '../ui/layout';
import { resolveLink } from './links';

const h2 = 'scroll-mt-20 pt-4 text-lg font-semibold tracking-tight';
const link = 'font-medium text-foreground underline underline-offset-4';

/** An element's props without react-markdown's `node`, which is not a DOM attribute. */
function own<T extends ExtraProps>({ node, ...rest }: T) {
  void node;
  return rest;
}

/**
 * One Help page's Markdown as React elements (spec Q3, Q12): GitHub's dialect (remark-gfm),
 * GitHub's heading anchors (rehype-slug), each element in the design system's classes, tables in
 * `TableBox`. Raw HTML is skipped and images are not rendered; unsafe URLs are emptied by
 * react-markdown's default. Nothing is ever set as HTML.
 */
export function HelpMarkdown({
  markdown,
  source,
  slugs,
  version,
}: {
  markdown: string;
  /** The page's repository path, which relative links are resolved from. */
  source: string;
  /** The pages that exist; a link to one stays in the app. */
  slugs: readonly string[];
  version: string;
}) {
  const components = useMemo<Components>(
    () => ({
      h1: (props) => <h2 {...own(props)} className={h2} />,
      h2: (props) => <h2 {...own(props)} className={h2} />,
      h3: (props) => <h3 {...own(props)} className="scroll-mt-20 text-base font-medium" />,
      h4: (props) => <h4 {...own(props)} className="scroll-mt-20 font-medium" />,
      p: (props) => <p {...own(props)} className="leading-7" />,
      ul: (props) => <ul {...own(props)} className="list-disc space-y-2 pl-5" />,
      ol: (props) => <ol {...own(props)} className="list-decimal space-y-2 pl-5" />,
      strong: (props) => <strong {...own(props)} className="font-semibold" />,
      code: (props) => (
        <code
          {...own(props)}
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] break-words"
        />
      ),
      pre: (props) => (
        <pre
          {...own(props)}
          className="overflow-x-auto rounded-lg border bg-muted p-3 font-mono text-sm [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[1em]"
        />
      ),
      blockquote: (props) => (
        <blockquote {...own(props)} className="border-l-2 pl-4 text-muted-foreground" />
      ),
      table: (props) => (
        <TableBox>
          <table {...own(props)} className={tableClass} />
        </TableBox>
      ),
      hr: () => <Separator />,
      a: ({ href, children }) => {
        const to = resolveLink(href ?? '', source, slugs, version);
        switch (to.kind) {
          case 'anchor':
            return (
              <a href={to.href} className={link}>
                {children}
              </a>
            );
          case 'page':
            return (
              <Link to={to.to} className={link}>
                {children}
              </Link>
            );
          case 'external':
            return (
              <a href={to.href} target="_blank" rel="noreferrer" className={link}>
                {children}
              </a>
            );
          case 'text':
            return <span>{children}</span>;
        }
      },
    }),
    [source, slugs, version],
  );
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSlug]}
      skipHtml
      disallowedElements={['img']}
      components={components}
    >
      {markdown}
    </Markdown>
  );
}
