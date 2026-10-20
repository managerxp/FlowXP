/*
 * The business logo (owner): picked from the phone's photos, sent to the server (PNG, JPEG or WebP up to 2 MB), shown here, and printed at the top of
 * receipts printed from the browser and on tax invoices. The same as the website's logo setting. Pure: the checks and the wording; the picking and the
 * upload are in LogoSetting.tsx.
 */
import { t } from './i18n.ts';

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** What is wrong with the picked image, in words, or '' when it can be sent. The server checks the real file again. */
export const logoProblem = (mime: string | undefined | null, bytes: number | undefined | null): string => {
  if (mime && !LOGO_TYPES.includes(mime.toLowerCase())) return 'The logo must be a PNG, JPEG or WebP image';
  if (bytes != null && bytes > MAX_LOGO_BYTES) return 'The logo must be 2 MB or smaller';
  return '';
};
export const logoFileName = (mime: string | undefined | null): string => `logo.${EXT[(mime ?? '').toLowerCase()] ?? 'jpg'}`;
/** A logo address as the server keeps it may be a path on the server: make it a full address the phone can show. */
export const logoSrc = (url: string | null | undefined, apiUrl: string): string | null => (!url ? null : /^https?:\/\//i.test(url) ? url : `${apiUrl.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`);
export const logoUrlOf = (receiptSettings: Record<string, unknown> | undefined): string | null => { const u = receiptSettings?.logo_url; return typeof u === 'string' && u ? u : null; };

export const LOGO_TEXTS: string[] = [
  'Logo', 'No logo yet', 'Choose a logo', 'Replace the logo', 'Remove the logo', 'Logo saved', 'Logo removed', 'PNG, JPEG or WebP up to 2 MB. A simple black-and-white logo prints best.',
  'The logo must be a PNG, JPEG or WebP image', 'The logo must be 2 MB or smaller', 'Could not save the logo. Check the connection and try again.', 'Working…'
];
export const logoWorking = (): string => t('Working…');
