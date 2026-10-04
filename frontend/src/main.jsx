import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { DialogProvider, ToastProvider } from './components/ui.jsx';
import App from './App.jsx';
import { registerServiceWorker } from './lib/pwa.js';
import '@fontsource-variable/plus-jakarta-sans';   // self-hosted: no request to Google, swapped in with the system font as the fallback
import './index.css';

registerServiceWorker();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <DialogProvider>
            <App />
          </DialogProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
