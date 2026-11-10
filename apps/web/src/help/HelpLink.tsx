import { Link } from 'react-router-dom';
import { HelpIcon } from '@/ui/icons';
import { useSettings } from '../session';

/**
 * A Help link on a screen: `<HelpLink page="how-miles-are-counted">How miles are counted</HelpLink>`.
 * Nothing at all while the owner has Help off (Settings > Help pages). `page` is a page's slug
 * (its file name in `docs/help/` without `.md`, or `whats-new`); a test fails on any other.
 * `children` is the visible text and the link's name. It does not check the page's module:
 * place it only on a screen of the same module. Imports no content, so it costs the main
 * bundle nothing.
 */
export function HelpLink({ page, children }: { page: string; children: string }) {
  const { help_enabled } = useSettings();
  if (!help_enabled) return null;
  return (
    <Link
      to={`/help/${page}`}
      className="rounded-extra-small text-label-large whitespace-nowrap text-on-surface-variant underline-offset-4 focus-ring hover:text-on-surface hover:underline"
    >
      <HelpIcon className="mr-1 inline-block size-[18px] align-[-0.25em]" />
      {children}
    </Link>
  );
}
