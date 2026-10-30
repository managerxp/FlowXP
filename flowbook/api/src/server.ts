/* FlowBook on its own port (development, or a separate deployment). In production it normally runs inside the FlowXP API instead: see boot.ts. */
import { bootFlowbook } from './boot.ts';

try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch { /* environment only */ }

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is required'); process.exit(1); }
const { app } = await bootFlowbook(url);
const port = Number(process.env.PORT ?? 5200);
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
console.log(`[flowbook] api listening on ${port}`);
