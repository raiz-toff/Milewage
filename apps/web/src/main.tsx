import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { PairPage } from './pages/PairPage';
import { SessionProvider } from './session';
import { applyTheme } from './theme';
import './index.css';

applyTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* The pairing QR's page is public: no session, no sign-in (plan 24 Q1). */}
    {location.pathname === '/pair' ? (
      <PairPage />
    ) : (
      <BrowserRouter>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    )}
  </StrictMode>,
);
