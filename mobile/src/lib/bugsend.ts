/* Wires "Report a problem" into the phone: the signed-in call to FlowXP, and the small queue on the phone for when there is no signal. */
import { Platform } from 'react-native';
import { NetworkError } from './api.ts';
import { api } from './session.ts';
import { kvGet, kvSet, scopeStore } from './local.ts';
import { appVersion } from './crash.ts';
import { flushReports, reportBody, submitReport, type ReportInput } from './bugreport.ts';

const queue = {
  read: async () => { try { return JSON.parse((await kvGet('bug_queue')) || '[]') as ReportInput[]; } catch { return []; } },
  write: (r: ReportInput[]) => kvSet('bug_queue', JSON.stringify(r))
};
const send = async (b: ReportInput) => { await api.post('/app-reports', b); };

/** Send a person's report with the app and phone facts. 'queued' means it is kept on the phone and goes out when there is a connection. */
export const sendReport = async (category: string, description: string, screen?: string): Promise<'sent' | 'queued'> => {
  const device = await scopeStore.get().scope?.outbox.device().catch(() => undefined);
  return submitReport(reportBody({ category, description, screen, version: appVersion(), platform: Platform.OS, os_version: String(Platform.Version), device }), send, queue, (e) => e instanceof NetworkError);
};
/** Send what was kept while there was no connection (called after sign-in and when the app opens). Never throws. */
export const flushBugReports = async (): Promise<number> => { try { return await flushReports(send, queue); } catch { return 0; } };
