/*
 * /delete-account — how to delete a FlowXP account and what happens to the data. Public, so the app store listing can link to it (Google Play asks for a web page
 * where a person can request this). The signed-in way is on the Security page; the form here is for someone who cannot sign in. Nothing is deleted by the form
 * alone: the backend (controllers/accountDeletion.controller.js) records the request and support checks who is asking first.
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Alert, Button, Field, Input, Section, Textarea } from '../components/ui.jsx';
import { PageHero } from './parts.jsx';

const RequestForm = () => {
  const [f, setF] = useState({ email: '', note: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api('/public/account-deletion', { method: 'POST', body: f }); setDone('We have your request.'); }
    catch (caught) { setError(caught.message); } finally { setBusy(false); }
  };
  if (done) {
    return (
      <div className="rounded-(--radius-panel) border border-line bg-surface p-8">
        <p className="text-title font-semibold text-ink-900">We have your request.</p>
        <p className="mt-2 text-body text-ink-500">FlowXP support will write to that address to confirm it is you, then delete the account. Nothing is deleted until you have confirmed.</p>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4 rounded-(--radius-panel) border border-line bg-surface p-6 sm:p-8">
      <Alert>{error}</Alert>
      <Field id="del-email" label="The email address of the account"><Input id="del-email" type="email" value={f.email} onChange={set('email')} required autoComplete="email" /></Field>
      <Field id="del-note" label="Anything we should know (optional)"><Textarea id="del-note" rows={3} maxLength={1000} value={f.note} onChange={set('note')} /></Field>
      {/* a field only a script fills in */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label></div>
      <Button type="submit" size="lg" loading={busy} className="w-full sm:w-auto">Ask for my account to be deleted</Button>
    </form>
  );
};

const DeleteAccountPage = () => {
  const [params] = useSearchParams();
  return (
  <>
    {params.get('done') === '1' && <p role="status" className="bg-success/10 px-4 py-3 text-center text-small font-medium text-ink-900">Your account has been deleted. Thank you for using FlowXP.</p>}
    <PageHero title="Delete your FlowXP account." lead="You can delete your account yourself, or ask us to. This page explains both and what happens to your information." cta={false} />

    <Section>
      <div className="mx-auto grid max-w-3xl gap-10">
        <div>
          <h2 className="text-h2 font-semibold text-ink-900">If you can sign in</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-body text-ink-700">
            <li><Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">Sign in</Link> on the website.</li>
            <li>Open <strong>Security</strong> (in the menu, or under your name).</li>
            <li>Choose <strong>Delete my account</strong>, enter your password, and confirm.</li>
          </ol>
          <p className="mt-3 text-body text-ink-500">In the phone app: Settings, then <strong>Delete my account</strong>, which opens this page.</p>
          <p className="mt-3 text-body text-ink-500">If you are the only owner of a business, it cannot be left without an owner. Make someone else an owner first, or leave a request below or in Security and FlowXP support will close the business or hand it over with you, then delete your account.</p>
        </div>

        <div>
          <h2 className="text-h2 font-semibold text-ink-900">What is deleted, and what is kept</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-body text-ink-700">
            <li><strong>Deleted straight away:</strong> your name, email address, phone number, password, two-step verification, approval PIN, the phones signed in to your account, and your notification settings. Every sign-in stops working.</li>
            <li><strong>Kept by the business:</strong> its bills, stock, customers and reports. They belong to the business, not to you, and tax law may require it to keep them. Bills you made will say they were made by a former team member.</li>
            <li><strong>Kept by us for a time:</strong> security and audit records (for example that a bill was made at a certain time) and encrypted backups, for the periods in our <Link to="/privacy" className="font-medium text-brand-600 hover:text-brand-700">Privacy policy</Link>. Backups are overwritten as they expire.</li>
          </ul>
        </div>

        <div>
          <h2 className="text-h2 font-semibold text-ink-900">If you cannot sign in</h2>
          <p className="mb-5 mt-2 text-body text-ink-500">Tell us the email address of the account. We will write to it to confirm it is you before anything is deleted.</p>
          <RequestForm />
        </div>
      </div>
    </Section>
  </>
  );
};

export default DeleteAccountPage;
