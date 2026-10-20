import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { DialogProvider, ToastProvider } from './components/ui.jsx';
import App from './App.jsx';
import './i18n/index.js';
import { LanguageSync } from './i18n/LanguageSync.jsx';
import { registerServiceWorker } from './lib/pwa.js';
import { applyTheme } from './lib/display.js';
import '@fontsource-variable/plus-jakarta-sans';   // self-hosted: no request to Google, swapped in with the system font as the fallback
import './index.css';

registerServiceWorker();
if (location.pathname.startsWith('/app')) applyTheme();   // the staff app opens in this device's theme from the first paint (public pages are never themed)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <LanguageSync />
        <ToastProvider>
          <DialogProvider>
            <App />
          </DialogProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
