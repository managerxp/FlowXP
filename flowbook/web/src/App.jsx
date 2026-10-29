import { useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api.js';
import { SessionProvider, useSession } from './session.jsx';
import { BRAND } from './lib.js';
import { Btn, Card, Err, Field, Loading, useAction } from './ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import { DocForm, DocList, DocView } from './pages/Documents.jsx';
import { PaymentForm, PaymentView, Payments } from './pages/Payments.jsx';
import { Items, Parties } from './pages/Contacts.jsx';
import { Accounts, JournalForm, JournalView, Journals } from './pages/Books.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';

const DOCS = [
  { path: 'sales', api: 'invoices', title: 'Sales invoices', one: 'Invoice', who: 'Customer', partyKind: 'CUSTOMER', paymentDirection: 'IN' },
  { path: 'purchases', api: 'bills', title: 'Purchase bills', one: 'Bill', who: 'Vendor', partyKind: 'VENDOR', paymentDirection: 'OUT' },
  { path: 'credit-notes', api: 'credit-notes', title: 'Credit notes', one: 'Credit note', who: 'Customer', partyKind: 'CUSTOMER' }
];

const NAV = [
  ['/', 'Home', null],
  ['/sales', 'Sales', 'Money in'], ['/credit-notes', 'Credit notes'], ['/payments', 'Payments'], ['/customers', 'Customers'],
  ['/purchases', 'Purchases', 'Money out'], ['/vendors', 'Vendors'],
  ['/items', 'Items', 'Books'], ['/accounts', 'Accounts'], ['/journals', 'Journals'], ['/reports', 'Reports'],
  ['/settings', 'Settings', 'Setup']
];

const AuthScreen = () => {
  const { signIn } = useSession();
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const a = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = (e) => { e.preventDefault(); a.run(() => (mode === 'login' ? signIn('/auth/login', { email: f.email, password: f.password }) : signIn('/auth/register', f))); };
  return (
    <div className="auth"><Card>
      <h1>{BRAND}</h1>
      <p className="muted">{mode === 'login' ? 'Sign in to your books.' : 'Create your account. You set up your business next.'}</p>
      <Err>{a.error}</Err>
      <form className="form" onSubmit={submit}>
        {mode === 'register' && <Field label="Your name"><input value={f.name} onChange={set('name')} required autoComplete="name" /></Field>}
        <Field label="Email"><input type="email" value={f.email} onChange={set('email')} required autoComplete="email" /></Field>
        <Field label="Password" hint={mode === 'register' ? 'At least 10 characters' : undefined}><input type="password" value={f.password} onChange={set('password')} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></Field>
        <Btn kind="primary" busy={a.busy}>{mode === 'login' ? 'Sign in' : 'Create account'}</Btn>
      </form>
      <p className="muted"><button className="linkish" onClick={() => { a.setError(''); setMode(mode === 'login' ? 'register' : 'login'); }}>{mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}</button></p>
    </Card></div>
  );
};

/** First run: the person has an account but no business yet. */
const CreateOrg = ({ first }) => {
  const { refresh, pick } = useSession();
  const [f, setF] = useState({ name: '', legalName: '', pan: '', template: 'GENERAL' });
  const a = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = (e) => {
    e.preventDefault();
    a.run(async () => {
      const body = { name: f.name, template: f.template, ...(f.legalName && { legalName: f.legalName }), ...(f.pan && { pan: f.pan.toUpperCase() }) };
      const created = await api('/organizations', { method: 'POST', body });
      await refresh(); pick(String(created.id));
    });
  };
  return (
    <Card title={first ? 'Set up your business' : 'Add a business'}>
      <p className="muted">You can add the GSTIN and address details later, in Settings.</p>
      <Err>{a.error}</Err>
      <form className="form" onSubmit={submit}>
        <Field label="Business name"><input value={f.name} onChange={set('name')} required /></Field>
        <Field label="Legal name" hint="As on your GST registration (optional)"><input value={f.legalName} onChange={set('legalName')} /></Field>
        <Field label="PAN" hint="Optional"><input value={f.pan} onChange={set('pan')} maxLength={10} pattern="[A-Za-z]{5}[0-9]{4}[A-Za-z]" title="Like ABCDE1234F" /></Field>
        <Field label="Kind of business" hint="Adds a few accounts that suit it"><select value={f.template} onChange={set('template')}>
          <option value="GENERAL">General</option><option value="CAFE">Cafe or restaurant</option><option value="RETAIL">Retail shop</option><option value="GYM">Gym</option><option value="AUTO_PARTS">Auto parts or workshop</option></select></Field>
        <div className="wide"><Btn kind="primary" busy={a.busy}>Create business</Btn></div>
      </form>
    </Card>
  );
};

const Shell = () => {
  const { user, orgs, org, pick, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const close = () => setOpen(false);
  return (
    <div className="shell">
      <header className="top">
        <button className="menu-btn" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '✕' : '☰'}</button>
        <NavLink to="/" className="brand" onClick={close}>{BRAND}</NavLink>
        <span className="spacer" />
        {orgs.length > 1 && <select className="org-pick" aria-label="Business" value={org?.id} onChange={(e) => pick(e.target.value)}>{orgs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
        {orgs.length === 1 && <span className="muted">{org.name}</span>}
        <button className="btn small" onClick={signOut} title={user.email}>Sign out</button>
      </header>
      <nav className={`side ${open ? 'open' : ''}`} onClick={close}>
        {NAV.map(([to, label, group]) => (
          <span key={to}>{group && <div className="group">{group}</div>}<NavLink to={to} end={to === '/'}>{label}</NavLink></span>
        ))}
      </nav>
      <main key={`${org?.id}`}>
        {!org ? <CreateOrg first /> : (
          <Routes location={loc}>
            <Route path="/" element={<Dashboard />} />
            {DOCS.flatMap((d) => [
              <Route key={`${d.path}-l`} path={`/${d.path}`} element={<DocList kind={d} />} />,
              <Route key={`${d.path}-n`} path={`/${d.path}/new`} element={<DocForm kind={d} />} />,
              <Route key={`${d.path}-e`} path={`/${d.path}/:id/edit`} element={<DocForm kind={d} />} />,
              <Route key={`${d.path}-v`} path={`/${d.path}/:id`} element={<DocView kind={d} />} />
            ])}
            <Route path="/payments" element={<Payments />} />
            <Route path="/payments/new" element={<PaymentForm />} />
            <Route path="/payments/:id" element={<PaymentView />} />
            <Route path="/customers" element={<Parties kind="CUSTOMER" />} />
            <Route path="/vendors" element={<Parties kind="VENDOR" />} />
            <Route path="/items" element={<Items />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/journals" element={<Journals />} />
            <Route path="/journals/new" element={<JournalForm />} />
            <Route path="/journals/:id" element={<JournalView />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<Settings AddBusiness={CreateOrg} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
    </div>
  );
};

const Gate = () => {
  const { ready, user } = useSession();
  if (!ready) return <div className="auth"><Loading /></div>;
  return user ? <Shell /> : <AuthScreen />;
};

export default () => <SessionProvider><Gate /></SessionProvider>;
