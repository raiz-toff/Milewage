import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  DarkModeIcon,
  LightModeIcon,
  LogoutIcon,
  NotificationsIcon,
  PersonIcon,
  PrivacyIcon,
  SettingsIcon,
  SystemModeIcon,
  UnfoldMoreIcon,
  WifiOffIcon,
} from '@/ui/icons';
import { Badge } from '@/components/ui/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { LogoMark } from '@/components/logo';
import { TooltipProvider } from '@/components/ui/tooltip';
import { InstallCard } from './pwa/Install';
import { navGroups, screenFlags, visibleScreens } from './screens';
import type { Screen } from './screens';
import { Onboarding } from './onboarding/Wizard';
import { Login } from './pages/Login';
import { RecoveryKey } from './pages/RecoveryKey';
import { Restore } from './pages/Restore';
import { Setup } from './pages/Setup';
import { useUnread } from './notifications';
import { PageErrorBoundary } from './ui/ErrorBoundary';
import { useSession } from './session';
import { useTheme } from './theme';
import type { ThemeChoice } from './theme';
import type { Settings } from './api/client';

function Notice({ children }: { children: string }) {
  return <p className="p-8 text-center text-muted-foreground">{children}</p>;
}

/**
 * The server did not answer (plan 27 section 4.5). The installed app opens without a network, so
 * this is what a driver sees offline: what is wrong and a way to try again, which also happens
 * by itself when the connection comes back.
 */
function Unreachable({ message }: { message: string }) {
  const { refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    await refresh();
    setBusy(false);
  };
  useEffect(() => {
    const back = () => void refresh();
    window.addEventListener('online', back);
    return () => window.removeEventListener('online', back);
  }, [refresh]);
  const offline = !navigator.onLine;
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 p-8 text-center">
      <WifiOffIcon aria-hidden className="size-6 text-muted-foreground" />
      <h1 className="text-title-large text-on-surface">
        {offline ? 'You are offline' : 'MileWage is not answering'}
      </h1>
      <p className="max-w-sm text-body-medium text-muted-foreground">
        {offline ? 'MileWage needs a connection to your server. Your data is safe there.' : message}
      </p>
      <Button onClick={() => void retry()} disabled={busy}>
        {busy ? 'Trying' : 'Try again'}
      </Button>
    </div>
  );
}

const routeOf = (s: Screen) => s.path.replace(/\/\*$/, '');
const isUnder = (pathname: string, route: string) =>
  pathname === route || pathname.startsWith(`${route}/`);

function NavItem({ screen, pathname }: { screen: Screen; pathname: string }) {
  const Icon = screen.nav!.icon;
  const active = isUnder(pathname, routeOf(screen));
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={screen.label}>
        {/* A destination picked with the mouse or a finger gives its focus up, so no focus ring
            comes back on it when the window is left and returned to. The keyboard (detail 0)
            keeps its focus and its ring. */}
        <NavLink
          to={routeOf(screen)}
          onClick={(e) => {
            if (e.detail > 0) e.currentTarget.blur();
          }}
        >
          {/* Material: the selected destination's icon is the filled form. */}
          <Icon filled={active} />
          <span>{screen.label}</span>
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** The account menu at the foot of the sidebar: who is signed in, account pages, sign out. */
function AccountMenu({ name }: { name: string | null }) {
  const { signOut } = useSession();
  const navigate = useNavigate();
  const shown = name?.trim() || 'Your account';
  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            size="lg"
            tooltip="Account"
            aria-label="Account"
            className="data-[state=open]:bg-sidebar-accent"
          >
            <div className="flex aspect-square size-8 items-center justify-center rounded-full bg-sidebar-accent text-title-small text-sidebar-accent-foreground uppercase">
              {name?.trim()[0] ?? <PersonIcon className="size-4" />}
            </div>
            <div className="grid flex-1 text-left">
              <span className="truncate text-label-large">{shown}</span>
              <span className="truncate text-body-small text-muted-foreground">Signed in</span>
            </div>
            <UnfoldMoreIcon className="ml-auto size-4" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          className="w-(--radix-dropdown-menu-trigger-width) min-w-52"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="truncate">{shown}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => navigate('/settings/account')}>
              <PersonIcon />
              Account
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate('/settings/general')}>
              <SettingsIcon />
              Settings
            </DropdownMenuItem>
            {/* A full page load: /privacy is a public page outside the router (publicPages.tsx). */}
            <DropdownMenuItem asChild>
              <a href="/privacy">
                <PrivacyIcon />
                Privacy
              </a>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void signOut()}>
            <LogoutIcon />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

function AppSidebar({ list, name }: { list: Screen[]; name: string | null }) {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  useEffect(() => setOpenMobile(false), [pathname, setOpenMobile]);
  const inGroup = (id: string) => list.filter((s) => s.nav?.group === id);
  const system = inGroup('system');

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/dashboard">
                {/* `size-8!`: the menu button shrinks every svg to 16 px; the mark must fill the
                    32 px button when the sidebar is collapsed, or the text leaks past it. */}
                <LogoMark size={32} className="size-8! shrink-0" />
                <div className="grid flex-1 text-left group-data-[collapsible=icon]:hidden">
                  <span className="truncate text-title-medium text-on-surface">MileWage</span>
                  <span className="truncate text-body-small text-muted-foreground">
                    Mileage and earnings
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col">
        <SidebarContent>
          {navGroups
            .filter((g) => g.id !== 'system')
            .map((g) => ({ ...g, items: inGroup(g.id) }))
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <SidebarGroup key={g.id}>
                <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {g.items.map((s) => (
                      <NavItem key={s.path} screen={s} pathname={pathname} />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          {/* The system pages scroll with the rest, at the foot when there is room; only the
              account stays pinned, so a short window keeps most of its height for the menu. */}
          {system.length > 0 ? (
            <SidebarGroup className="mt-auto">
              <SidebarGroupContent>
                <SidebarMenu>
                  {system.map((s) => (
                    <NavItem key={s.path} screen={s} pathname={pathname} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ) : null}
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border">
          <InstallCard />
          <SidebarMenu>
            <AccountMenu name={name} />
          </SidebarMenu>
        </SidebarFooter>
      </nav>
    </Sidebar>
  );
}

const THEMES: { value: ThemeChoice; label: string; icon: typeof LightModeIcon }[] = [
  { value: 'light', label: 'Light', icon: LightModeIcon },
  { value: 'dark', label: 'Dark', icon: DarkModeIcon },
  { value: 'system', label: 'System', icon: SystemModeIcon },
];

function ThemeMenu() {
  const [choice, setChoice] = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Theme">
          <LightModeIcon className="dark:hidden" />
          <DarkModeIcon className="hidden dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={choice} onValueChange={(v) => setChoice(v as ThemeChoice)}>
          {THEMES.map((t) => (
            <DropdownMenuRadioItem key={t.value} value={t.value}>
              <t.icon />
              {t.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Shell({ settings }: { settings: Settings }) {
  const list = visibleScreens(screenFlags(settings));
  const unread = useUnread(settings.modules.notifications);
  const { pathname } = useLocation();
  const current = list.find((s) => isUnder(pathname, routeOf(s)));
  const notifications = list.some((s) => s.path === '/notifications');

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar list={list} name={settings.display_name ?? null} />
        <SidebarInset>
          <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-vertical:h-4 data-vertical:self-center"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage>{current?.label ?? 'MileWage'}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <div className="ml-auto flex items-center gap-1">
              <ThemeMenu />
              {notifications ? (
                <Button variant="ghost" size="icon" className="relative" asChild>
                  <NavLink
                    to="/notifications"
                    aria-label={unread > 0 ? `Notifications (${unread})` : 'Notifications'}
                  >
                    <NotificationsIcon filled={pathname === '/notifications'} />
                    {unread > 0 ? (
                      <Badge
                        variant="count"
                        className="pointer-events-none absolute top-1 left-[22px] tabular-nums"
                      >
                        {unread > 99 ? '99+' : unread}
                      </Badge>
                    ) : null}
                  </NavLink>
                </Button>
              ) : null}
            </div>
          </header>
          <main className="flex-1 p-4 md:p-6">
            <div className="mx-auto w-full max-w-6xl">
              <PageErrorBoundary resetKey={pathname}>
                <Routes>
                  {list.map((s) => (
                    <Route key={s.path} path={s.path} element={s.element} />
                  ))}
                  <Route
                    path="*"
                    element={<Navigate to={list[0] ? routeOf(list[0]) : '/'} replace />}
                  />
                </Routes>
              </PageErrorBoundary>
            </div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

/** Auth shell: decides between setup, sign-in and the app from what the server says. */
export function App() {
  const { state } = useSession();
  const { pathname } = useLocation();
  const [restoring, setRestoring] = useState(false);
  switch (state.status) {
    case 'loading':
      return <Notice>Loading</Notice>;
    case 'error':
      return <Unreachable message={state.message} />;
    case 'needs_setup':
      return restoring ? (
        <Restore onBack={() => setRestoring(false)} />
      ) : (
        <Setup onRestore={() => setRestoring(true)} />
      );
    case 'needs_confirmation':
      return <RecoveryKey />;
    case 'signed_out':
      return <Login />;
    case 'ready':
      // Not onboarded yet (plan 23): the wizard comes first; "Continue setup" opens it later.
      return state.settings.onboarded_at === null || isUnder(pathname, '/onboarding') ? (
        <Onboarding />
      ) : (
        <Shell settings={state.settings} />
      );
  }
}
