/* "Report a problem": what a person types when something goes wrong, sent to FlowXP with the app version and phone facts so the team can find it. The person and business come from
   their signed-in session on the server. With no signal the report waits on the phone (the newest five) and is sent when the app next has a connection. */

export const CATEGORIES: readonly (readonly [string, string])[] = [['BROKE', 'Something broke'], ['WRONG', 'A figure is wrong'], ['SLOW', 'It is slow'], ['IDEA', 'An idea'], ['OTHER', 'Something else']];
export const MIN_WORDS = 10;

export type ReportInput = { category: string; description: string; screen?: string; version?: string; platform?: string; os_version?: string; device?: string };

export const reportProblem = (description: string): string => (description.trim().length < MIN_WORDS ? 'Tell us what went wrong, in a few words.' : description.trim().length > 2000 ? 'That is too long. Keep it under 2,000 characters.' : '');
export const reportBody = (input: ReportInput): ReportInput => ({ ...input, description: input.description.trim().slice(0, 2000), category: CATEGORIES.some(([k]) => k === input.category) ? input.category : 'OTHER' });

export type ReportQueue = { read: () => Promise<ReportInput[]>; write: (r: ReportInput[]) => Promise<void> };
/** Send it now; if there is no connection keep it (the newest five) and say so. A refusal by the server is reported to the caller, not kept. */
export const submitReport = async (body: ReportInput, send: (b: ReportInput) => Promise<void>, queue: ReportQueue, isNetworkError: (e: unknown) => boolean): Promise<'sent' | 'queued'> => {
  try { await send(body); return 'sent'; }
  catch (e) {
    if (!isNetworkError(e)) throw e;
    await queue.write([...(await queue.read()), body].slice(-5));
    return 'queued';
  }
};
/** Send what was kept, oldest first; stop at the first failure and keep the rest. */
export const flushReports = async (send: (b: ReportInput) => Promise<void>, queue: ReportQueue): Promise<number> => {
  const waiting = await queue.read();
  let sent = 0;
  for (const r of waiting) { try { await send(r); sent++; } catch { break; } }
  if (sent) await queue.write(waiting.slice(sent));
  return sent;
};
