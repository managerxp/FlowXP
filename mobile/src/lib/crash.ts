/* Wires the reporter into the phone: where reports go, where the queue lives, and the global handler for errors nothing else caught. */
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import { API_URL } from './session.ts';
import { kvGet, kvSet, scopeStore } from './local.ts';
import { createReporter, type Context, type Report } from './report.ts';

export const appVersion = () => `${Application.nativeApplicationVersion ?? 'dev'} (${Application.nativeBuildVersion ?? '0'})`;

const send = async (r: Report) => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 5000);
  try {
    const res = await fetch(`${API_URL}/api/app-errors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r), signal: abort.signal });
    if (!res.ok) throw new Error(`status ${res.status}`);
  } finally { clearTimeout(timer); }
};

const reporter = createReporter({
  send,
  queue: {
    read: async () => { try { return JSON.parse((await kvGet('crash_queue')) || '[]') as Report[]; } catch { return []; } },
    write: (reports) => kvSet('crash_queue', JSON.stringify(reports))
  }
});

const context = async (screen?: string, fatal?: boolean): Promise<Context> => ({
  screen, fatal, version: appVersion(), platform: Platform.OS, os_version: String(Platform.Version),
  device: await scopeStore.get().scope?.outbox.device().catch(() => undefined)
});

/** Report an error (an error boundary, a caught failure that should not happen). Never throws. */
export const reportError = async (error: unknown, screen?: string, fatal = false) => reporter.report(error, await context(screen, fatal));
export const flushReports = () => reporter.flush();

/** Catch what nothing else did, keep the default behaviour (the red screen in development, the crash in production). */
export const installCrashReporting = () => {
  const globalAny = globalThis as unknown as { ErrorUtils?: { getGlobalHandler: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void } };
  const utils = globalAny.ErrorUtils;
  if (!utils) return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, fatal) => { void reportError(error, undefined, Boolean(fatal)); previous(error, fatal); });
  void flushReports();
};
