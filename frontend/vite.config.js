import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/* Lists the built files the service worker keeps for offline use. */
const precacheList = () => ({
  name: 'flowxp-precache',
  generateBundle(_options, bundle) {
    const files = Object.keys(bundle).filter((f) => f.startsWith('assets/')).map((f) => '/' + f);
    this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify(files) });
  }
});

export default defineConfig({
  plugins: [react(), tailwindcss(), precacheList()],
  server: {
    /* 5174, not the Vite default: the ManagerXP platform's own frontend lives
       on 5173 and the two get run side by side. */
    port: 5174,
    strictPort: true,
    /* The API runs on its own port. Proxying it under /api in development
       means the app calls same-origin paths everywhere and there is no CORS
       to configure locally — and the same relative paths work in production
       behind one domain. */
    proxy: {
      '/api': { target: 'http://localhost:5100', changeOrigin: true },
      // Uploaded product photos (middleware/upload.js) live on the API
      // server's own disk, served at /uploads — same same-origin reasoning
      // as /api above.
      '/uploads': { target: 'http://localhost:5100', changeOrigin: true }
    }
  },
  build: {
    rollupOptions: {
      output: {
        /* React and the router change far less often than our own code.
           Splitting them out means a copy deploy does not invalidate the
           largest chunk in every returning user's cache. */
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom']
        }
      }
    }
  }
});
