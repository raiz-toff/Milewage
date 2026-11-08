import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { publicPage } from './publicPages';
import { UpdatePrompt } from './pwa/UpdatePrompt';
import { captureInstallPrompt } from './pwa/install';
import { startUpdates } from './pwa/update';
import { SessionProvider } from './session';
import { applyTheme } from './theme';
import './index.css';

applyTheme();
captureInstallPrompt();
startUpdates(registerSW);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* The pairing QR's page, the app download page and the privacy page are public: no
        session, no sign-in (publicPages.tsx). */}
    {publicPage(location.pathname) ?? (
      <BrowserRouter>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    )}
    <UpdatePrompt />
  </StrictMode>,
);
