import { useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api.js';
import { SessionProvider, useSession } from './session.jsx';
import { wordmark } from './lib.js';
import { Btn, Card, Err, Field, Loading, useAction } from './ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import { DocForm, DocList, DocView } from './pages/Documents.jsx';
import { PaymentForm, PaymentView, Payments } from './pages/Payments.jsx';
import { Items, Parties } from './pages/Contacts.jsx';
import Stock from './pages/Stock.jsx';
import Assets from './pages/Assets.jsx';
import { Accounts, JournalForm, JournalView, Journals } from './pages/Books.jsx';
import Bank from './pages/Bank.jsx';
import Expenses from './pages/Expenses.jsx';
import Recurring from './pages/Recurring.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';

const DOCS = [
  { path: 'sales', api: 'invoices', title: 'Sales invoices', one: 'Invoice', who: 'Customer', partyKind: 'CUSTOMER', paymentDirection: 'IN' },
  { path: 'purchases', api: 'bills', title: 'Purchase bills', one: 'Bill', who: 'Vendor', partyKind: 'VENDOR', paymentDirection: 'OUT' },
  { path: 'credit-notes', api: 'credit-notes', title: 'Credit notes', one: 'Credit note', who: 'Customer', partyKind: 'CUSTOMER' },
  { path: 'quotes', api: 'quotes', title: 'Quotes', one: 'Quote', who: 'Customer', partyKind: 'CUSTOMER', pre: true, dueLabel: 'Valid until' },
  { path: 'debit-notes', api: 'debit-notes', title: 'Debit notes', one: 'Debit note', who: 'Vendor', partyKind: 'VENDOR' },
  { path: 'purchase-orders', api: 'purchase-orders', title: 'Purchase orders', one: 'Purchase order', who: 'Vendor', partyKind: 'VENDOR', pre: true, dueLabel: 'Expected by' },
  { path: 'sales-orders', api: 'sales-orders', title: 'Sales orders', one: 'Sales order', who: 'Customer', partyKind: 'CUSTOMER', pre: true, dueLabel: 'Expected by' }
];

/* [path, label, icon]; a group is a heading and the links under it */
const ICON = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  invoice: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
  credit: 'M6 3h9l4 4v14H6zM9 14l3-3 3 3M12 11v7',
  repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 01-4 4H4',
  people: 'M16 20v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M9.5 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 20v-2a4 4 0 00-3-3.9M16 3.1a3.5 3.5 0 010 6.8',
  bill: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6',
  bank: 'M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18',
  wallet: 'M3 7h16a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2zM3 7l13-3v3M17 13.5h.01',
  cash: 'M2 6h20v12H2zM12 15a3 3 0 100-6 3 3 0 000 6z',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  book: 'M4 4h12a3 3 0 013 3v13H7a3 3 0 01-3-3zM4 17a3 3 0 013-3h12',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 00-2-1.2L14 3h-4l-.6 2.6a7 7 0 00-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 000 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 002 1.2L10 21h4l.6-2.6a7 7 0 002-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z'
};
const NAV = [
  { items: [['/', 'Home', 'home']] },
  { label: 'Sales', items: [['/quotes', 'Quotes', 'bill'], ['/sales-orders', 'Sales orders', 'list'], ['/sales', 'Invoices', 'invoice'], ['/credit-notes', 'Credit notes', 'credit'], ['/recurring', 'Recurring', 'repeat'], ['/customers', 'Customers', 'people']] },
  { label: 'Purchases', items: [['/purchase-orders', 'Purchase orders', 'list'], ['/purchases', 'Bills', 'bill'], ['/debit-notes', 'Debit notes', 'credit'], ['/expenses', 'Expenses', 'wallet'], ['/vendors', 'Vendors', 'people']] },
  { label: 'Money', items: [['/payments', 'Payments', 'cash'], ['/bank', 'Bank', 'bank']] },
  { label: 'Books', items: [['/items', 'Items', 'box'], ['/stock', 'Stock', 'list'], ['/assets', 'Fixed assets', 'box'], ['/accounts', 'Accounts', 'list'], ['/journals', 'Journals', 'book'], ['/reports', 'Reports', 'chart']] },
  { label: 'Setup', items: [['/settings', 'Settings', 'gear']] }
];
const Icon = ({ name }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICON[name]} /></svg>;

const Wordmark = () => { const [a, b] = wordmark(); return <span className="wordmark">{a}<span>{b}</span></span>; };
const initials = (name = '') => name.split(/s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'B';

const AuthScreen = () => {
  const { signIn } = useSession();
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const a = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = (e) => { e.preventDefault(); a.run(() => (mode === 'login' ? signIn('/auth/login', { email: f.email, password: f.password }) : signIn('/auth/register', f))); };
  return (
    <div className="auth"><Card>
      <Wordmark />
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
      {open && <div className="backdrop" onClick={close} aria-hidden="true" />}
      <aside className={`side ${open ? 'open' : ''}`} aria-label="Main menu">
        <div className="side-head">
          <NavLink to="/" onClick={close} aria-label="Home"><Wordmark /></NavLink>
          <button className="icon-btn side-close" aria-label="Close menu" onClick={close}>✕</button>
        </div>
        <nav onClick={close}>
          {NAV.map((g, i) => (
            <div key={i} className="nav-group">{g.label && <p className="nav-label">{g.label}</p>}
              {g.items.map(([to, label, icon]) => <NavLink key={to} to={to} end={to === '/'} className="nav-item"><Icon name={icon} />{label}</NavLink>)}</div>
          ))}
        </nav>
      </aside>
      <div className="col">
        <header className="top">
          <button className="icon-btn menu-btn" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>☰</button>
          {orgs.length > 1
            ? <select className="org-pick" aria-label="Business" value={org?.id} onChange={(e) => pick(e.target.value)}>{orgs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            : org && <p className="who" style={{ margin: 0 }}><span className="chip" aria-hidden="true">{initials(org.name)}</span><span className="name">{org.name}</span></p>}
          <span className="spacer" />
          <button className="btn small" onClick={signOut} title={user.email}>Sign out</button>
        </header>
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
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/bank" element={<Bank />} />
            <Route path="/recurring" element={<Recurring />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/payments/new" element={<PaymentForm />} />
            <Route path="/payments/:id" element={<PaymentView />} />
            <Route path="/customers" element={<Parties kind="CUSTOMER" />} />
            <Route path="/vendors" element={<Parties kind="VENDOR" />} />
            <Route path="/items" element={<Items />} />
            <Route path="/stock" element={<Stock />} />
            <Route path="/assets" element={<Assets />} />
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
    </div>
  );
};

const Gate = () => {
  const { ready, user } = useSession();
  if (!ready) return <div className="auth"><Loading /></div>;
  return user ? <Shell /> : <AuthScreen />;
};

export default () => <SessionProvider><Gate /></SessionProvider>;
