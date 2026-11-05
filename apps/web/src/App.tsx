import { useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { visibleScreens } from './screens';
import { Login } from './pages/Login';
import { RecoveryKey } from './pages/RecoveryKey';
import { Restore } from './pages/Restore';
import { Setup } from './pages/Setup';
import { useSession } from './session';
import type { Settings } from './api/client';

function Notice({ children }: { children: string }) {
  return <p className="p-8 text-center text-muted">{children}</p>;
}

function Shell({ settings }: { settings: Settings }) {
  const { signOut } = useSession();
  const list = visibleScreens(settings.modules);
  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-6 border-b border-line bg-card px-6 py-3">
        <span className="font-heading text-xl">MileWage</span>
        <nav aria-label="Main" className="flex flex-1 gap-4">
          {list.map((s) => (
            <NavLink
              key={s.path}
              to={s.path.replace(/\/\*$/, '')}
              className={({ isActive }) => (isActive ? 'text-accent' : 'text-muted hover:text-ink')}
            >
              {s.label}
            </NavLink>
          ))}
        </nav>
        <button type="button" className="text-muted hover:text-ink" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <main className="mx-auto max-w-6xl p-6">
        <Routes>
          {list.map((s) => (
            <Route key={s.path} path={s.path} element={s.element} />
          ))}
          <Route
            path="*"
            element={<Navigate to={list[0]?.path.replace(/\/\*$/, '') ?? '/'} replace />}
          />
        </Routes>
      </main>
    </div>
  );
}

/** Auth shell: decides between setup, sign-in and the app from what the server says. */
export function App() {
  const { state } = useSession();
  const [restoring, setRestoring] = useState(false);
  switch (state.status) {
    case 'loading':
      return <Notice>Loading</Notice>;
    case 'error':
      return <Notice>{state.message}</Notice>;
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
      return <Shell settings={state.settings} />;
  }
}
