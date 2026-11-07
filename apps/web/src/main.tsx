import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AppPage } from './pages/AppPage';
import { PairPage } from './pages/PairPage';
import { SessionProvider } from './session';
import { applyTheme } from './theme';
import './index.css';

applyTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* The pairing QR's page and the app download page are public: no session, no sign-in. */}
    {location.pathname === '/pair' ? (
      <PairPage />
    ) : location.pathname === '/app' ? (
      <AppPage />
    ) : (
      <BrowserRouter>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    )}
  </StrictMode>,
);
