import { useId } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/** One group of a `SectionNav`: its heading and its links, in order. */
export interface NavSection {
  label: string;
  items: { to: string; label: string }[];
}

const isUnder = (pathname: string, to: string) => pathname === to || pathname.startsWith(`${to}/`);

/**
 * The list of a page's sections (Settings) or pages (Help). Where there is room it is a grouped
 * list beside the content that stays in view; where there is not, one menu button that names the
 * open one ("Section: Units and format"). Neither ever scrolls sideways. Place it in a
 * `@container` grid with `@2xl:grid-cols-[200px_minmax(0,1fr)]`.
 *
 * `label` names the navigation for screen readers; `noun` starts the narrow button's text. The
 * current item is the one whose `to` the address is at or under, else the first.
 */
export function SectionNav({
  label,
  noun,
  groups,
}: {
  label: string;
  noun: string;
  groups: NavSection[];
}) {
  const { pathname } = useLocation();
  const id = useId();
  const items = groups.flatMap((g) => g.items);
  const current = items.find((s) => isUnder(pathname, s.to)) ?? items[0];
  return (
    <nav
      aria-label={label}
      className="@2xl:sticky @2xl:top-20 @2xl:max-h-[calc(100svh-6rem)] @2xl:self-start @2xl:overflow-y-auto @2xl:[scrollbar-width:thin]"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-full justify-between @md:w-72 @2xl:hidden">
            <span className="truncate">
              <span className="text-muted-foreground">{noun}:</span> {current?.label}
            </span>
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-(--radix-dropdown-menu-trigger-width)">
          {groups.map((g, i) => (
            <DropdownMenuGroup key={g.label}>
              {i > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {g.label}
              </DropdownMenuLabel>
              {g.items.map((s) => (
                <DropdownMenuItem key={s.to} asChild>
                  <Link
                    to={s.to}
                    aria-current={s === current ? 'page' : undefined}
                    className="aria-[current=page]:font-medium"
                  >
                    {s.label}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="hidden space-y-4 text-sm @2xl:block">
        {groups.map((g, i) => (
          <div key={g.label} className="space-y-1">
            <p id={`${id}-${i}`} className="px-3 text-xs font-medium text-muted-foreground">
              {g.label}
            </p>
            <ul aria-labelledby={`${id}-${i}`} className="flex flex-col gap-1">
              {g.items.map((s) => (
                <li key={s.to}>
                  <NavLink
                    to={s.to}
                    className={({ isActive }) =>
                      cn(
                        'block rounded-md px-3 py-1.5 transition-colors',
                        isActive
                          ? 'bg-muted font-medium text-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )
                    }
                  >
                    {s.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

/** A row that leads to another page of the app: its title, one line about it, a chevron. */
export function LinkRow({ to, title, children }: { to: string; title: string; children: string }) {
  return (
    <li>
      <Link
        to={to}
        className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted"
      >
        <span className="space-y-0.5">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-sm text-muted-foreground">{children}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}
