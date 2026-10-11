/*
 * Telling FlowXP when the app breaks. A report is only technical facts (the error, the screen, the app version, the phone's OS and its
 * 3-letter device code): no name, no business, no sale. It is sent at once; with no connection it waits in a small queue on the phone
 * (the newest 20) and goes out later. The same message is not sent more than once a minute, so one broken screen cannot flood the server.
 */
export type Report = { message: string; stack?: string; screen?: string; fatal?: boolean; version?: string; platform?: string; os_version?: string; device?: string };
export type Context = Omit<Report, 'message' | 'stack'>;
export type Queue = { read: () => Promise<Report[]>; write: (reports: Report[]) => Promise<void> };

export const toReport = (error: unknown, context: Context): Report => {
  const e = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error) ?? 'Unknown error');
  return { ...context, message: (e.message || e.name || 'Unknown error').slice(0, 500), stack: e.stack?.slice(0, 4000) };
};

export const createReporter = ({ send, queue, now = () => Date.now(), gapMs = 60000, cap = 20 }: { send: (r: Report) => Promise<void>; queue: Queue; now?: () => number; gapMs?: number; cap?: number }) => {
  const lastSent = new Map<string, number>();

  return {
    /** Send it; if that fails, keep it for later. Never throws: reporting a crash must not cause another. */
    report: async (error: unknown, context: Context): Promise<'sent' | 'queued' | 'skipped'> => {
      try {
        const r = toReport(error, context);
        const at = lastSent.get(r.message);
        if (at !== undefined && now() - at < gapMs) return 'skipped';
        lastSent.set(r.message, now());
        try { await send(r); return 'sent'; }
        catch { await queue.write([...(await queue.read()), r].slice(-cap)); return 'queued'; }
      } catch { return 'skipped'; }
    },

    /** Send what was kept while there was no connection, oldest first; stops at the first failure and keeps the rest. */
    flush: async (): Promise<number> => {
      try {
        const waiting = await queue.read();
        let sent = 0;
        for (const r of waiting) { try { await send(r); sent++; } catch { break; } }
        if (sent) await queue.write(waiting.slice(sent));
        return sent;
      } catch { return 0; }
    }
  };
};
