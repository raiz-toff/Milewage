import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { publicPage } from './publicPages';
import { createQueryClient } from './api/query';
import { UpdatePrompt } from './pwa/UpdatePrompt';
import { captureInstallPrompt } from './pwa/install';
import { startUpdates } from './pwa/update';
import { SessionProvider } from './session';
import { applyTheme } from './theme';
import './index.css';

applyTheme();
captureInstallPrompt();
startUpdates(registerSW);

const queryClient = createQueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* The pairing QR's page, the app download page and the privacy page are public: no
        session, no sign-in (publicPages.tsx). */}
    {publicPage(location.pathname) ?? (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <SessionProvider>
            <App />
          </SessionProvider>
        </BrowserRouter>
      </QueryClientProvider>
    )}
    <UpdatePrompt />
  </StrictMode>,
);
