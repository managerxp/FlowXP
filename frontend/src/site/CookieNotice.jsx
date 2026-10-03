/*
 * The cookie notice on the public website: one line that says what is true (no advertising or tracking cookies; the
 * browser keeps only what FlowXP needs to work), a link to the full list (/cookies), and "OK". There is no
 * Accept/Reject choice because there is nothing optional to accept or reject; if analytics or anything else that is
 * not strictly necessary is ever added, this becomes a real choice and nothing optional runs before a yes.
 * Seen once per browser (localStorage flowxp.cookies.seen); sits bottom-left so it never covers the chat button.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Cookie } from 'lucide-react';

const KEY = 'flowxp.cookies.seen';
const seen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } };

const CookieNotice = () => {
  const [show, setShow] = useState(() => !seen());
  if (!show) return null;
  const ok = () => { try { localStorage.setItem(KEY, '1'); } catch { /* private mode: it shows again next visit */ } setShow(false); };
  return (
    <section aria-label="Cookies" className="cookie-notice fixed inset-x-3 bottom-20 z-[55] mx-auto max-w-md rounded-(--radius-card) border border-line bg-surface p-4 shadow-lg sm:inset-x-auto sm:bottom-6 sm:left-6 sm:mx-0 sm:max-w-sm">
      <div className="flex gap-3">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Cookie className="h-[18px] w-[18px]" strokeWidth={2} /></span>
        <p className="text-small text-ink-700">
          No advertising or tracking cookies here. Your browser keeps only what FlowXP needs to work, like keeping you signed in.{' '}
          <Link to="/cookies" className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700">Cookie policy</Link>
        </p>
      </div>
      <div className="mt-3 flex justify-end">
        <button type="button" onClick={ok} className="h-9 rounded-(--radius-control) bg-ink-900 px-4 text-small font-semibold text-white transition-[background-color,transform] duration-(--duration-fast) hover:bg-ink-700 active:scale-[0.98]">OK</button>
      </div>
    </section>
  );
};

export default CookieNotice;
