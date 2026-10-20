/*
 * The activity log and account security on the phone (owner and admin for the log and the team's sign-ins; everyone for their own account).
 * The same things as the website's Activity log and Security pages: who did what and when (filterable, exportable), two-step verification with
 * an authenticator app and recovery codes, the password, signing out every other device, the approval PIN and the till's approval rules, and
 * recent sign-ins. Pure: what to ask the server and how to read its answers. The server checks everything again and its messages are shown.
 */
import { authHeaders, type BackupRequest } from './backup.ts';

/* ── activity log ────────────────────────────────────────────────────────── */
export type ActivityEntry = { audit_id: number; at: string; user: string; role: string | null; category: string; summary: string; outlet: string | null };
export type ActivityPage = { entries: ActivityEntry[]; next: number | null; categories: { key: string; label: string }[] };
export type ActivityFilters = { user_id: string; category: string; outlet: string; q: string; from: string; to: string };

/** The query string for GET /audit: only the filters that are set, plus `before` for the next older page. */
export const activityQuery = (f: ActivityFilters, extra: Record<string, string | number | null | undefined> = {}): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v !== '' && v != null) p.set(k, String(v));
  return p.toString();
};
/** The CSV export of the same filters (the server needs the export permission). */
export const activityCsvRequest = (apiUrl: string, session: { token: string | null; businessId: number | null; branchId: number | null }, f: ActivityFilters): BackupRequest => ({
  url: `${apiUrl.replace(/\/$/, '')}/api/audit?${activityQuery(f, { format: 'csv', q: '' })}`, headers: authHeaders(session), fileName: `activity-${f.from}-to-${f.to}.csv`
});
const pad = (n: number) => String(n).padStart(2, '0');
const dayText = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** The date range the log opens on: the last `days` days up to today, in the phone's own calendar. */
export const lastDays = (days: number, now: Date = new Date()): { from: string; to: string } => { const f = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)); return { from: dayText(f), to: dayText(now) }; };
/** 15 Oct, 14:05: when it happened, in the phone's clock. */
export const whenText = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const roleText = (role: string | null): string => (role ? role.toLowerCase().replace(/_/g, ' ') : '');

/* ── sign-ins ────────────────────────────────────────────────────────────── */
export type LoginEvent = { event_id: number; outcome: string; method?: string | null; ip: string | null; device: string | null; new_device?: boolean; at: string; name?: string | null; email?: string };
export const OUTCOME: Record<string, { label: string; bad: boolean }> = {
  SUCCESS: { label: 'Signed in', bad: false }, BAD_PASSWORD: { label: 'Wrong password', bad: true }, UNKNOWN_USER: { label: 'Unknown address', bad: true }, LOCKED: { label: 'Locked out', bad: true }, TWO_FACTOR_FAILED: { label: 'Wrong code', bad: true }
};
/** "Chrome on Windows", "Android", or the start of the raw text when the device is not recognised. */
export const deviceName = (ua: string | null | undefined): string => {
  if (!ua) return 'Unknown device';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return [browser, os].filter(Boolean).join(' on ') || (/okhttp|FlowXP|Expo/i.test(ua) ? 'FlowXP app' : ua.slice(0, 40));
};

/* ── two-step verification ───────────────────────────────────────────────── */
export type TwoFactorStatus = { enabled: boolean; recovery_codes_left: number; required: boolean };
export type TwoFactorSetup = { secret: string; otpauth_url: string };
/** A code is 6 digits (spaces allowed); a recovery code has a dash. Anything else is not sent. */
export const cleanCode = (code: string): string => code.trim().replace(/\s+/g, '');
export const isRecoveryCode = (code: string): boolean => code.includes('-');
export const looksLikeCode = (code: string): boolean => /^\d{6}$/.test(cleanCode(code)) || /^[A-Za-z0-9]{4,}-[A-Za-z0-9-]{3,}$/.test(code.trim());
export const enableBody = (code: string) => ({ code: cleanCode(code) });
export const disableBody = (password: string, code: string) => ({ password, ...(isRecoveryCode(code) ? { recovery_code: code.trim() } : { code: cleanCode(code) }) });
/** The recovery codes as text to hand to the share sheet (the phone's own "save it somewhere" step). */
export const recoveryText = (codes: string[]): string => `FlowXP recovery codes (each works once):\n${codes.join('\n')}`;
/** Said under the codes left, once they are running out. */
export const codesLow = (left: number): boolean => left <= 2;

/* ── password ────────────────────────────────────────────────────────────── */
export const MIN_PASSWORD = 10;
/** Why a new password is not good enough yet, or '' when it is (the server decides finally). */
export const passwordProblem = (current: string, next: string): string => (!current ? 'Enter your current password.' : next.length < MIN_PASSWORD ? 'The new password needs at least 10 characters.' : next === current ? 'Choose a different password from the current one.' : '');
export const changePasswordBody = (current: string, next: string) => ({ current_password: current, new_password: next });

/* ── approval PIN and rules ──────────────────────────────────────────────── */
export const pinProblem = (pin: string): string => (/^\d{4,8}$/.test(pin) ? '' : 'The PIN is 4 to 8 digits.');
export type ApprovalRules = { discount_cap_pct: number; cancel_needs_approval: boolean; approvers?: { user_id: number; name: string; role: string; has_pin: boolean }[] };
export const capProblem = (cap: string): string => { const n = Number(cap); return cap.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100 ? '' : 'Enter a number from 0 to 100.'; };

/* ── the team's sign-ins ─────────────────────────────────────────────────── */
export type TeamSecurity = {
  require_2fa_admins: boolean; members: { user_id: number; name: string; email: string; role: string; two_factor: boolean }[];
  summary: { failed_7d: number; new_devices_7d: number; privileged_without_2fa: number }; events: LoginEvent[];
};

/** Owners and admins see the activity log and the team's sign-ins; only the owner changes the two-step policy. */
export const canSeeTeamSecurity = (role: string | undefined): boolean => role === 'OWNER' || role === 'ADMIN';

/** Every fixed text on these screens, so the language tests can check each is translated. */
export const SECURITY_TEXTS: string[] = [
  'Activity log', 'Security', 'Who did what, and when. Everything that changes money, stock, the menu or the team is recorded here.', 'The activity log is for owners and admins.', 'Everyone', 'All areas', 'All outlets', 'Search…', 'Today', '7 days', '30 days',
  'Person', 'Area', 'Outlet', 'Nothing recorded for these filters.', 'Show older', 'That’s everything for these days.', 'Export CSV', 'Could not load.', 'Back', 'Done',
  'Keep your account and your business safe.', 'Two-step verification', 'On', 'Off', 'After your password, you enter a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password). A stolen password alone is then not enough.',
  'Your business requires two-step verification for owners and admins. Set it up to continue using FlowXP.', 'Set up two-step verification', 'Open the authenticator app', 'Or enter this key by hand in your authenticator app:', 'Enter the 6-digit code it shows to confirm.', 'Code from your app', 'Turn on',
  'Save these recovery codes now', 'Each works once if you lose your phone. They are shown only this time. Keep them somewhere safe, not on the same phone.', 'Save the codes', 'I have saved them', '{n} recovery codes left', '1 recovery code left', '· get new ones soon',
  'New recovery codes', 'Turn off two-step verification', 'Your password', 'A code, or a recovery code', 'Turn off', 'Two-step verification is off', 'Enter your password and a code.',
  'Password and devices', 'Current password', 'New password', 'At least 10 characters', 'Change password', 'Enter your current password.', 'The new password needs at least 10 characters.', 'Choose a different password from the current one.', 'Password changed. Your other devices were signed out.',
  'Lost a phone, or used a shared computer? End every other session at once.', 'Sign out everywhere else', 'Sign out everywhere else?', 'Every other device and tab is signed out. You stay signed in here.', 'Sign out others', 'Every other device was signed out', 'Cancel',
  'Your approval PIN', 'Staff at the till ask for this PIN to cancel a bill or give a large discount.', 'You have a PIN set.', 'You have not set one yet, so nobody can ask you.', 'PIN', 'New PIN', '4 to 8 digits', 'Set PIN', 'Change PIN', 'Remove PIN', 'The PIN is 4 to 8 digits.', 'PIN saved', 'PIN removed',
  'Manager approval at the till', 'Owners, admins and managers are never held back. Everyone else needs one of them to type in their PIN.', 'Biggest discount staff may give alone (%)', 'Of the bill, for discounts typed in at the till. Offers you set up are not counted.', 'Enter a number from 0 to 100.',
  "Cancelling a bill needs a manager's PIN", 'Staff also have to say why.', 'Who can approve', 'Set', 'Not set', 'Nobody yet.', 'Save', 'Saved', 'Could not save. Check the connection and try again.',
  'Your recent sign-ins', "If you see one you don't recognise, change your password and sign out everywhere.", 'Signed in', 'Wrong password', 'Unknown address', 'Locked out', 'Wrong code', 'recovery code', 'new device', 'Unknown device', 'Nothing yet.',
  'Your team’s sign-ins', 'failed attempts in the last 7 days', 'sign-ins from new devices', 'owners/admins without two-step verification', 'Require two-step verification for owners and admins', 'Until they set it up, they cannot use the app. Turn on only once everyone is ready.',
  'Owners and admins must now use two-step verification', 'Policy switched off', 'Recent activity', 'Delete my account', 'Erases your name, email, phone and sign-ins from FlowXP. The business keeps its bills and records.'
];
