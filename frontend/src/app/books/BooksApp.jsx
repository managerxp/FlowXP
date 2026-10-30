/* FlowBook inside the FlowXP app, at /app/books. FlowXP's own sidebar and top bar are around it; this is the books' own sections, the Simple/Full switch and the help. */
import { Navigate, NavLink, Route, Routes, useLocation } from './router.jsx';
import { SessionProvider, useSession } from './session.jsx';
import { setMode, useSimple } from './mode.js';
import { HelpButton, HelpPanel, HelpProvider } from './help.jsx';
import { Card, Err, Loading } from './ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import { DocForm, DocList, DocView } from './pages/Documents.jsx';
import { PaymentForm, PaymentView, Payments } from './pages/Payments.jsx';
import { Items, Parties } from './pages/Contacts.jsx';
import Stock from './pages/Stock.jsx';
import Assets from './pages/Assets.jsx';
import Projects, { ProjectView } from './pages/Projects.jsx';
import { Accounts, JournalForm, JournalView, Journals } from './pages/Books.jsx';
import Bank from './pages/Bank.jsx';
import Expenses from './pages/Expenses.jsx';
import Recurring from './pages/Recurring.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import './books.css';

const DOCS = [
  { path: 'sales', api: 'invoices', title: 'Sales invoices', one: 'Invoice', who: 'Customer', partyKind: 'CUSTOMER', paymentDirection: 'IN' },
  { path: 'purchases', api: 'bills', title: 'Purchase bills', one: 'Bill', who: 'Vendor', partyKind: 'VENDOR', paymentDirection: 'OUT' },
  { path: 'credit-notes', api: 'credit-notes', title: 'Credit notes', one: 'Credit note', who: 'Customer', partyKind: 'CUSTOMER' },
  { path: 'quotes', api: 'quotes', title: 'Quotes', one: 'Quote', who: 'Customer', partyKind: 'CUSTOMER', pre: true, dueLabel: 'Valid until' },
  { path: 'debit-notes', api: 'debit-notes', title: 'Debit notes', one: 'Debit note', who: 'Vendor', partyKind: 'VENDOR' },
  { path: 'purchase-orders', api: 'purchase-orders', title: 'Purchase orders', one: 'Purchase order', who: 'Vendor', partyKind: 'VENDOR', pre: true, dueLabel: 'Expected by' },
  { path: 'sales-orders', api: 'sales-orders', title: 'Sales orders', one: 'Sales order', who: 'Customer', partyKind: 'CUSTOMER', pre: true, dueLabel: 'Expected by' }
];

/* a section is a heading and the screens under it */
const NAV = [
  { items: [['/', 'Home', 'home']] },
  { label: 'Sales', items: [['/quotes', 'Quotes', 'bill'], ['/sales-orders', 'Sales orders', 'list'], ['/sales', 'Invoices', 'invoice'], ['/credit-notes', 'Credit notes', 'credit'], ['/recurring', 'Recurring', 'repeat'], ['/projects', 'Projects', 'list'], ['/customers', 'Customers', 'people']] },
  { label: 'Purchases', items: [['/purchase-orders', 'Purchase orders', 'list'], ['/purchases', 'Bills', 'bill'], ['/debit-notes', 'Debit notes', 'credit'], ['/expenses', 'Expenses', 'wallet'], ['/vendors', 'Vendors', 'people']] },
  { label: 'Money', items: [['/payments', 'Payments', 'cash'], ['/bank', 'Bank', 'bank']] },
  { label: 'Books', items: [['/items', 'Items', 'box'], ['/stock', 'Stock', 'list'], ['/assets', 'Fixed assets', 'box'], ['/accounts', 'Accounts', 'list'], ['/journals', 'Journals', 'book'], ['/reports', 'Reports', 'chart']] },
  { label: 'Setup', items: [['/settings', 'Settings', 'gear']] }
];
/* the advanced screens the FlowXP super admin can switch off (keys in api/src/features.ts) */
const NEEDS = { '/quotes': 'flowbook_quotes_orders', '/sales-orders': 'flowbook_quotes_orders', '/purchase-orders': 'flowbook_quotes_orders', '/credit-notes': 'flowbook_notes', '/debit-notes': 'flowbook_notes', '/recurring': 'flowbook_recurring', '/projects': 'flowbook_projects', '/bank': 'flowbook_bank', '/stock': 'flowbook_stock', '/assets': 'flowbook_assets', '/journals': 'flowbook_journals' };
const SIMPLE = new Set(['/', '/sales', '/customers', '/purchases', '/expenses', '/vendors', '/payments', '/items', '/stock', '/reports', '/settings']);

/** A section's tab goes to its first visible screen; the screens of the open section are listed under the tabs. */
const Frame = () => {
  const { ready, org, on, error } = useSession();
  const simple = useSimple();
  const here = useLocation().pathname;
  if (!ready) return <div className="fb"><Loading /></div>;
  if (!org) return <div className="fb"><Card title="FlowBook"><Err>{error || 'Your books could not be opened.'}</Err></Card></div>;
  if (!on('flowbook_app')) return <div className="fb"><Card title="FlowBook is switched off"><p>FlowBook is not part of this business's plan right now. Contact FlowXP support or upgrade your plan to use it.</p></Card></div>;

  const groups = NAV.map((g) => ({ ...g, items: g.items.filter(([to]) => (!simple || SIMPLE.has(to)) && on(NEEDS[to] || 'flowbook_app')) })).filter((g) => g.items.length);
  const open = (to) => (to === '/' ? here === '/' : here === to || here.startsWith(`${to}/`));
  const current = groups.find((g) => g.items.some(([to]) => open(to)));
  return (
    <div className="fb">
      <div className="fb-bar">
        <nav className="fb-tabs" aria-label="FlowBook sections">
          {groups.map((g, i) => <NavLink key={i} to={g.items[0][0]} className={`fb-tab ${g === current ? 'active' : ''}`}>{g.label || 'Home'}</NavLink>)}
        </nav>
        <div className="fb-tools">
          <div className="seg" role="group" aria-label="How much to show">
            <button className={simple ? 'on' : ''} aria-pressed={simple} onClick={() => setMode('simple')}>Simple</button>
            <button className={simple ? '' : 'on'} aria-pressed={!simple} onClick={() => setMode('full')}>Full</button>
          </div>
          <HelpButton />
        </div>
      </div>
      {current && current.items.length > 1 && (
        <nav className="fb-sub" aria-label={`${current.label} screens`}>
          {current.items.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'} className={`fb-pill ${open(to) ? 'active' : ''}`}>{label}</NavLink>)}
        </nav>
      )}
      <Routes>
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
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectView />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/journals" element={<Journals />} />
        <Route path="/journals/new" element={<JournalForm />} />
        <Route path="/journals/:id" element={<JournalView />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <HelpPanel />
    </div>
  );
};

export default () => <SessionProvider><HelpProvider><Frame /></HelpProvider></SessionProvider>;
