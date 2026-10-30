import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// the API is on its own port in development; in production put both behind one host so /v1 is same-origin
// FlowBook runs inside the FlowXP API at /books (port 5100). To try it as its own process instead (api: `npm start`, port 5200), start this with FLOWBOOK_API=http://127.0.0.1:5200
const standalone = process.env.FLOWBOOK_API;
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/books/' : '/',   // in production FlowBook lives on the same site, at flowxp.in/books
  plugins: [react()],
  server: { port: 5300, proxy: { '/v1': standalone ? { target: standalone } : { target: 'http://127.0.0.1:5100', rewrite: (p) => `/books${p}` } } }
}));
