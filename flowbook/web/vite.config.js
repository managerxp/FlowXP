import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// the API is on its own port in development; in production put both behind one host so /v1 is same-origin
export default defineConfig({
  plugins: [react()],
  server: { port: 5300, proxy: { '/v1': 'http://127.0.0.1:5200' } }
});
