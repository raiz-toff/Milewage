import { Link } from 'react-router-dom';
import { ChevronLeftIcon } from '@/ui/icons';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader } from '../ui/layout';
import type { HelpPage } from './catalog';
import { HelpMarkdown } from './HelpMarkdown';
import { githubUrl } from './source';

const link =
  'text-on-surface underline decoration-primary decoration-2 underline-offset-4 hover:decoration-[3px]';

/** A page's `##` headings as in-page links, for pages long enough to need them. */
function OnThisPage({ page }: { page: HelpPage }) {
  const top = page.headings.filter((h) => h.depth === 2);
  if (top.length < 3) return null;
  return (
    <nav
      aria-label="On this page"
      className="space-y-2 rounded-xl border border-outline-variant p-4 text-body-medium"
    >
      <p className="text-title-small text-on-surface">On this page</p>
      <ul className="space-y-1">
        {top.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** One Help page: the way back, its title and summary, its contents, the text and its version. */
export function HelpArticle({
  page,
  slugs,
  version,
}: {
  page: HelpPage;
  slugs: readonly string[];
  version: string;
}) {
  return (
    <div className="max-w-3xl min-w-0 space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/help">
          <ChevronLeftIcon />
          All help pages
        </Link>
      </Button>
      <PageHeader title={page.title} description={page.summary} />
      {page.body.trim() === '' ? (
        <EmptyState>
          <p>No notes for MileWage {version} yet.</p>
          <p className="mt-2">
            <a
              href={githubUrl(page.source, version)}
              target="_blank"
              rel="noreferrer"
              className={link}
            >
              Read the changelog on GitHub
            </a>
          </p>
        </EmptyState>
      ) : (
        <>
          <OnThisPage page={page} />
          <article className="space-y-4 text-body-large text-on-surface">
            <HelpMarkdown
              markdown={page.body}
              source={page.source}
              slugs={slugs}
              version={version}
            />
          </article>
          <footer className="border-t border-outline-variant pt-4 text-body-medium text-muted-foreground">
            This page describes MileWage {version}.{' '}
            <a
              href={githubUrl(page.source, version)}
              target="_blank"
              rel="noreferrer"
              className={link}
            >
              Read it on GitHub
            </a>
          </footer>
        </>
      )}
    </div>
  );
}
