import { Link } from 'react-router-dom';
import { useLoad } from '../api.js';
import { financialYear, showDate, today } from '../lib.js';
import { useSession } from '../session.jsx';
import { Badge, Card, Empty, Money, Page, Table } from '../ui.jsx';

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
      <div className="grid">
        <Stat k="Customers owe you">{owed.data ? <Money v={owed.data.total} /> : '–'}</Stat>
        <Stat k="…of which overdue" tone={overdue ? 'bad' : ''}>{overdue === null ? '–' : <Money v={overdue} />}</Stat>
        <Stat k="You owe vendors">{payable.data ? <Money v={payable.data.total} /> : '–'}</Stat>
        <Stat k="Profit this year" tone={pnl.data && Number(pnl.data.netProfit) < 0 ? 'bad' : 'ok'}>{pnl.data ? <Money v={pnl.data.netProfit} /> : '–'}</Stat>
      </div>

      {checks.data && (checks.data.issues.length
        ? <p className="notice warn" role="alert"><strong>Your books need a look:</strong> {checks.data.issues.slice(0, 3).join(' · ')}{checks.data.issues.length > 3 ? ` (+${checks.data.issues.length - 3} more)` : ''}</p>
        : <p className="notice ok">Books check: every figure agrees with its documents.</p>)}

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
