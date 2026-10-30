import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLoad } from '../api.js';
import { financialYear, gstDueDates, showDate, today } from '../lib.js';
import { useSession } from '../session.jsx';
import { Badge, Card, Empty, Money, Page, Table } from '../ui.jsx';

/** First steps for a new business: each one ticks itself off when it is done, and the whole card can be hidden. */
const GetStarted = ({ org }) => {
  const { o } = useSession();
  const key = `fb_start_${org.id}`;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(key) === '1'; } catch { return false; } });
  const profile = useLoad(() => o('/profile'), [org.id]);
  const customers = useLoad(() => o('/parties?kind=CUSTOMER&limit=1'), [org.id]);
  const items = useLoad(() => o('/items'), [org.id]);
  const invoices = useLoad(() => o('/invoices?limit=1'), [org.id]);
  const payments = useLoad(() => o('/payments?limit=1'), [org.id]);
  if (hidden || [profile, customers, items, invoices, payments].some((x) => x.loading && !x.data)) return null;
  const steps = [
    [Boolean(profile.data?.address_line || profile.data?.phone || profile.data?.gstin), 'Add your business details', 'Your address and phone appear on every invoice.', '/settings'],
    [Boolean(customers.data?.length), 'Add a customer', 'Someone you sell to. Just a name is enough to start.', '/customers'],
    [Boolean(items.data?.length), 'Add what you sell', 'Each product or service once, with its price. Then invoices fill in the price for you.', '/items'],
    [Boolean(invoices.data?.documents?.length), 'Make your first invoice', 'Pick the customer, add the items, press Issue.', '/sales/new'],
    [Boolean(payments.data?.payments?.length), 'Record a payment', 'When a customer pays, record it so their balance is right.', '/payments/new?direction=IN']
  ];
  const left = steps.filter((x) => !x[0]).length;
  if (!left) return null;
  const hide = () => { try { localStorage.setItem(key, '1'); } catch { /* hidden for this visit only */ } setHidden(true); };
  return (
    <Card title={`Get started: ${steps.length - left} of ${steps.length} done`} actions={<button className="linkish" onClick={hide}>Hide</button>}>
      <ul className="start-list">
        {steps.map(([done, title, why, to]) => (
          <li key={title} className={done ? 'done' : ''}><span className="tick" aria-hidden="true">{done ? '✓' : ''}</span>
            <span>{done ? title : <Link to={to}><strong>{title}</strong></Link>}{!done && <span className="why">{why}</span>}</span></li>
        ))}
      </ul>
    </Card>
  );
};

const Stat = ({ k, children, tone = '' }) => <div className={`stat ${tone}`}><div className="k">{k}</div><div className="v">{children}</div></div>;

export default () => {
  const { o, org } = useSession();
  const fy = financialYear();
  // each figure loads on its own, so one a person may not see (their role) does not blank the page
  const owed = useLoad(() => o(`/reports/ageing?type=receivables&asOf=${today()}`), [org.id]);
  const payable = useLoad(() => o(`/reports/ageing?type=payables&asOf=${today()}`), [org.id]);
  const pnl = useLoad(() => o(`/reports/profit-and-loss?from=${fy.from}&to=${fy.to}`), [org.id]);
  const checks = useLoad(() => o('/reports/reconcile'), [org.id]);
  const recent = useLoad(() => o('/invoices?limit=6'), [org.id]);
  const overdue = owed.data ? owed.data.rows.reduce((a, r) => a + Number(r.days_1_30) + Number(r.days_31_60) + Number(r.days_61_90) + Number(r.days_over_90), 0) : null;

  return (
    <Page title={org.name} lead={`${fy.label} so far`} actions={<><Link className="btn primary" to="/sales/new">New invoice</Link><Link className="btn" to="/payments/new">Record payment</Link></>}>
      <GetStarted org={org} />
      <div className="grid">
        <Stat k="Customers owe you">{owed.data ? <Money v={owed.data.total} /> : '–'}</Stat>
        <Stat k="…of which overdue" tone={overdue ? 'bad' : ''}>{overdue === null ? '–' : <Money v={overdue} />}</Stat>
        <Stat k="You owe vendors">{payable.data ? <Money v={payable.data.total} /> : '–'}</Stat>
        <Stat k="Profit this year" tone={pnl.data && Number(pnl.data.netProfit) < 0 ? 'bad' : 'ok'}>{pnl.data ? <Money v={pnl.data.netProfit} /> : '–'}</Stat>
      </div>

      {checks.data && (checks.data.issues.length
        ? <p className="notice warn" role="alert"><strong>Your books need a look:</strong> {checks.data.issues.slice(0, 3).join(' · ')}{checks.data.issues.length > 3 ? ` (+${checks.data.issues.length - 3} more)` : ''}</p>
        : <p className="notice ok">Books check: every figure agrees with its documents.</p>)}

      <Card title="Coming up" actions={<Link to="/reports">GST returns</Link>}>
        <Table head={['Return', 'Due', '>In']}>
          {gstDueDates().map((d) => <tr key={d.form + d.label}><td>{d.form}<div className="muted">{d.label}</div></td><td>{showDate(d.due)}</td><td className="r">{d.days === 0 ? 'today' : `${d.days} days`}</td></tr>)}
        </Table>
        <p className="muted">Dates for monthly filers. Quarterly filers (QRMP) and extensions differ, so check the GST portal.</p>
      </Card>

      <Card title="Latest invoices" actions={<Link to="/sales">See all</Link>}>
        {recent.data && (
          <Table head={['Number', 'Customer', 'Date', 'Status', '>Total']} empty={!recent.data.documents.length && <Empty>No invoices yet. Create your first one.</Empty>}>
            {recent.data.documents.map((d) => (
              <tr key={d.id}><td><Link to={`/sales/${d.id}`}>{d.number || 'Draft'}</Link></td><td>{d.party_name}</td><td>{showDate(d.issue_date)}</td><td><Badge status={d.status} /></td><td className="r"><Money v={d.total_minor} /></td></tr>
            ))}
          </Table>
        )}
      </Card>
    </Page>
  );
};
