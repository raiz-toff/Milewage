import { useEffect, useId, useMemo } from 'react';
import { Link, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useSettings } from '../session';
import { EmptyState, PageHeader } from '../ui/layout';
import { SectionNav } from '../ui/nav';
import { GROUPS, pageOf } from './catalog';
import type { HelpPage } from './catalog';
import { catalog } from './content';
import { HelpArticle } from './HelpArticle';
import { HelpIndex } from './HelpIndex';
import { VersionNote } from './VersionNote';

/** `/help/<slug>`: the page beside the list of pages, or the "no such page" state. */
function PageView({ pages, slugs }: { pages: HelpPage[]; slugs: readonly string[] }) {
  const { slug } = useParams();
  const { hash } = useLocation();
  const top = useId();
  const page = pageOf(pages, slug);

  // The page is drawn after the browser's own jump to the #fragment, so jump here; a new page
  // without one starts at its top.
  useEffect(() => {
    const target = hash
      ? document.getElementById(decodeURIComponent(hash.slice(1)))
      : window.scrollY > 0
        ? document.getElementById(top)
        : null;
    target?.scrollIntoView?.({ block: 'start' });
  }, [slug, hash, top]);

  if (!page)
    return (
      <div className="max-w-3xl space-y-6">
        <PageHeader title="Help" />
        <EmptyState>
          <p>There is no help page called &quot;{slug}&quot;.</p>
          <p className="mt-2">
            <Link to="/help" className="font-medium text-foreground underline underline-offset-4">
              All help pages
            </Link>
          </p>
        </EmptyState>
      </div>
    );

  const groups = GROUPS.map((g) => ({
    label: g.label,
    items: pages
      .filter((p) => p.group === g.id)
      .map((p) => ({ to: `/help/${p.slug}`, label: p.title })),
  })).filter((g) => g.items.length > 0);

  return (
    <div id={top} className="scroll-mt-20 space-y-6">
      <VersionNote version={catalog.version} />
      {/* Sized by its own width, as Settings is: the side list needs room beside the page. */}
      <div className="@container">
        <div className="grid gap-6 @2xl:grid-cols-[220px_minmax(0,1fr)] @2xl:gap-8">
          <SectionNav label="Help pages" noun="Page" groups={groups} />
          <HelpArticle page={page} slugs={slugs} version={catalog.version} />
        </div>
      </div>
    </div>
  );
}

/**
 * Everything under `/help` (lazy, with the content and the Markdown libraries). A page whose
 * module is off is left out everywhere, so its address answers like an unknown page.
 */
export default function HelpRoutes() {
  const { modules } = useSettings();
  const pages = useMemo(
    () => catalog.pages.filter((p) => !p.module || modules[p.module]),
    [modules],
  );
  // Links to a page that is not shown are plain text (links.ts).
  const slugs = useMemo(() => pages.map((p) => p.slug), [pages]);
  return (
    <Routes>
      <Route index element={<HelpIndex pages={pages} version={catalog.version} />} />
      <Route path=":slug" element={<PageView pages={pages} slugs={slugs} />} />
    </Routes>
  );
}
