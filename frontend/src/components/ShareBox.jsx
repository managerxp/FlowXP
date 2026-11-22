/*
 * "Put this on your website": a booking link shown three ways, each with a Copy button.
 *   the link itself (WhatsApp, Instagram bio, Google Business profile), a ready button for any web page, and a frame that shows the page inside the website.
 * The frame needs the server to allow framing of the booking pages (deploy/nginx.conf, location /book/ and /reserve/); the button and the link need nothing.
 */
import { useState } from 'react';
import { Button, useToast } from './ui.jsx';

const Snippet = ({ label, hint, text }) => {
  const toast = useToast();
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-small font-medium text-ink-900">{label}</p>
        <Button type="button" variant="secondary" size="sm" onClick={() => navigator.clipboard?.writeText(text).then(() => toast.success('Copied'))}>Copy</Button>
      </div>
      {hint && <p className="text-caption text-ink-500">{hint}</p>}
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-(--radius-control) bg-surface-2 px-3 py-2 text-caption text-ink-700">{text}</pre>
    </div>
  );
};

export default function ShareBox({ link, buttonText = 'Book now' }) {
  const [open, setOpen] = useState(false);
  if (!link) return null;
  const button = `<a href="${link}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 22px;background:#0f766e;color:#fff;border-radius:8px;font-family:sans-serif;font-weight:600;text-decoration:none">${buttonText}</a>`;
  const frame = `<iframe src="${link}" title="${buttonText}" style="width:100%;max-width:640px;height:760px;border:0;border-radius:12px" loading="lazy"></iframe>`;
  return (
    <div className="space-y-3 rounded-(--radius-control) border border-line px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <a href={link} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-small font-medium text-brand-600 underline">{link}</a>
        <Button type="button" variant="secondary" size="sm" onClick={() => navigator.clipboard?.writeText(link)}>Copy link</Button>
      </div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="text-small font-medium text-brand-600 hover:underline">{open ? 'Hide' : 'Put it on my website'}</button>
      {open && (
        <div className="space-y-4">
          <Snippet label="A button for your website" hint="Paste this where you want the button to appear." text={button} />
          <Snippet label="Show it inside your page" hint="Paste this to show the booking page right on your website. Ask your web person to paste it into the page." text={frame} />
        </div>
      )}
    </div>
  );
}
