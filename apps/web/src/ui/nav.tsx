import { useId } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ArrowDropDownIcon, ChevronRightIcon } from '@/ui/icons';
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
import { withRipple } from '@/components/ui/ripple';
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
 * `@container` grid with `@2xl:grid-cols-[220px_minmax(0,1fr)]`.
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
            <ArrowDropDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-(--radix-dropdown-menu-trigger-width)">
          {groups.map((g, i) => (
            <DropdownMenuGroup key={g.label}>
              {i > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel>{g.label}</DropdownMenuLabel>
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
      <div className="hidden space-y-2 @2xl:block">
        {groups.map((g, i) => (
          <div key={g.label} className="space-y-1">
            <p id={`${id}-${i}`} className="px-4 py-2 text-title-small text-on-surface">
              {g.label}
            </p>
            {/* The links sit indented under their group's heading. */}
            <ul aria-labelledby={`${id}-${i}`} className="ml-3 flex flex-col">
              {g.items.map((s) => (
                <li key={s.to}>
                  <NavLink
                    to={s.to}
                    onPointerDown={withRipple()}
                    className={({ isActive }) =>
                      cn(
                        'relative flex min-h-10 items-center rounded-[20px] px-4 py-2 text-label-large state-layer focus-ring transition-colors',
                        isActive
                          ? 'bg-secondary-container text-on-secondary-container'
                          : 'text-on-surface-variant',
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

/**
 * A row that leads to another page of the app, as a Material two-line list item: its title in
 * body-large, one line about it in body-medium on-surface-variant, a trailing chevron.
 */
export function LinkRow({ to, title, children }: { to: string; title: string; children: string }) {
  return (
    <li>
      <Link
        to={to}
        onPointerDown={withRipple()}
        className="relative flex min-h-16 items-center justify-between gap-4 px-4 py-2 state-layer focus-ring focus-visible:-outline-offset-3"
      >
        <span className="space-y-0.5">
          <span className="block text-body-large text-on-surface">{title}</span>
          <span className="block text-body-medium text-on-surface-variant">{children}</span>
        </span>
        <ChevronRightIcon className="size-6 shrink-0 text-on-surface-variant" />
      </Link>
    </li>
  );
}
