import { useId } from 'react';
import { Card } from '@/components/ui/card';
import { PageHeader } from '../ui/layout';
import { LinkRow } from '../ui/nav';
import { GROUPS } from './catalog';
import type { HelpGroup, HelpPage } from './catalog';
import { VersionNote } from './VersionNote';

function GroupList({ label, pages }: { label: string; pages: HelpPage[] }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h2 id={id} className="text-base leading-snug font-medium">
        {label}
      </h2>
      <Card className="py-0">
        <ul className="divide-y">
          {pages.map((p) => (
            <LinkRow key={p.slug} to={`/help/${p.slug}`} title={p.title}>
              {p.summary}
            </LinkRow>
          ))}
        </ul>
      </Card>
    </section>
  );
}

/** `/help`: every page the driver can read, by group, with its one-line summary. */
export function HelpIndex({ pages, version }: { pages: HelpPage[]; version: string }) {
  const inGroup = (g: HelpGroup) => pages.filter((p) => p.group === g);
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Help"
        description={`How MileWage works, in plain words. For MileWage ${version}.`}
      />
      <VersionNote version={version} />
      {GROUPS.filter((g) => inGroup(g.id).length > 0).map((g) => (
        <GroupList key={g.id} label={g.label} pages={inGroup(g.id)} />
      ))}
    </div>
  );
}
