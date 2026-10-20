/*
 * The owner's backup on the phone: the same ZIP of CSV files the website downloads (GET /businesses/current/backup, owner only), saved to the
 * phone and handed to the share sheet, so it can go to Drive, e-mail or a computer. Only the request is worked out here (testable); the
 * download and the share sheet are in share.ts. FlowXP does not restore from it by itself: that is said on the screen.
 */
export type BackupRequest = { url: string; headers: Record<string, string>; fileName: string };

/** The headers the server wants from the app on every call. */
export const authHeaders = (session: { token: string | null; businessId: number | null; branchId: number | null }): Record<string, string> => ({
  'X-Requested-With': 'FlowXP',
  ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
  ...(session.businessId != null ? { 'X-Business-Id': String(session.businessId) } : {}),
  ...(session.branchId != null ? { 'X-Branch-Id': String(session.branchId) } : {})
});

/** The URL, the headers the server wants from the app, and the file name (flowxp-backup-YYYY-MM-DD.zip). */
export const backupRequest = (apiUrl: string, session: { token: string | null; businessId: number | null; branchId: number | null }, today: string): BackupRequest => ({
  url: `${apiUrl.replace(/\/$/, '')}/api/businesses/current/backup`,
  headers: authHeaders(session),
  fileName: `flowxp-backup-${today}.zip`
});

/** Only the business owner can take a backup (the server refuses anyone else); the card is simply not shown to others. */
export const canBackUp = (role: string | undefined): boolean => role === 'OWNER';
