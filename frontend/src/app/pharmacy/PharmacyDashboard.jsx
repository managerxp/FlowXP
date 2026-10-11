/*
 * The pharmacy's front page: today's sales, then expiry and stock alerts, and the last few goods receipts.
 * Sales come from GET /api/dashboard (pharmacy bills are ordinary invoices, so the same figures, trend and best
 * sellers as every other business; the 14-day chart and best sellers only for people who may see reports).
 * Stock and receipts come from the endpoints the Inventory and Goods receipts screens use, so they always match.
 */
import { Package, Plus, ReceiptText, TriangleAlert } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { dateText, money, qty, useLoad } from '../../lib/pharmacy.js';
import { Alert, Button, EmptyState, DashboardHeader, SkeletonCards, StatCard, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { BusyHours, PaymentMix, SalesChart, TodayFigures, TodayVsUsual, TopProducts, useTodayReport } from '../Dashboard.jsx';
import { Panel } from './parts.jsx';

const PharmacyDashboard = () => {
  const { business, can } = useAuth();
  // Stock, expiry and goods receipts are loaded only for people the server lets read them (a cashier at the counter gets the sales figures and nothing else).
  const seesStock = can('inventory'); const seesGrn = can('purchases') || can('inventory');
  const expiry = useLoad(seesStock ? '/pharmacy/inventory/expiry' : null);
  const stock = useLoad(seesStock ? '/pharmacy/inventory/stock?limit=200' : null, { paged: true });
  const grn = useLoad(seesGrn ? '/pharmacy/grn?limit=5' : null, { paged: true });
  const dash = useLoad('/dashboard');
  const m = dash.data?.metrics; const sales = dash.data?.sales;
  const today = useTodayReport(m?.today, Boolean(sales));

  const low = (stock.data || []).filter((r) => r.low);
  // expiry_alert_days is sorted ascending (pharmacy/common.js), so the first bucket is the soonest window
  const expiringSoon = expiry.data?.buckets?.[0]?.batches ?? 0;

  return (
    <div>
      <DashboardHeader title={business?.name || 'Today'} lead="Today's sales, stock and expiry, and the last few goods receipts, at a glance."
                  action={<>{can('billing') && <Button to="/app/pharmacy/pos"><Plus aria-hidden="true" className="h-4 w-4" />New sale</Button>}{can('purchases') && <Button to="/app/pharmacy/grn" variant="secondary"><Package aria-hidden="true" className="h-4 w-4" />Receive goods</Button>}</>} />
      <Alert>{dash.error || expiry.error || stock.error || grn.error}</Alert>
      {(dash.loading && !dash.data) ? <div className="mb-3"><SkeletonCards count={4} /></div> : m && (
        <div className="mb-3"><TodayFigures m={m} trend={sales?.trend} /></div>
      )}
      {!seesStock ? null : (expiry.loading && !expiry.data) ? <SkeletonCards count={3} /> : (
        <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard to="/app/pharmacy/inventory?tab=batches" label="Expired batches" value={expiry.data?.expired ?? '—'} tone={expiry.data?.expired > 0 ? 'danger' : undefined} note={expiry.data?.expired > 0 ? 'Still showing as stock until pulled' : 'None in stock'} />
          <StatCard to="/app/pharmacy/inventory?tab=batches" label="Expiring soon" value={expiringSoon} tone={expiringSoon > 0 ? 'warning' : undefined} note="Within your alert window" />
          <StatCard to="/app/pharmacy/inventory" label="Low or out of stock" value={low.length} tone={low.length > 0 ? 'warning' : undefined} note={low.length > 0 ? 'Below reorder level' : 'Above reorder level'} />
        </section>
      )}

      {sales && m && (
        <>
          <div className="mt-6 grid gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2"><SalesChart trend={sales.trend} /></div>
            <TodayVsUsual m={m} trend={sales.trend} />
          </div>
          <div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            <PaymentMix report={today || null} />
            <BusyHours report={today || null} />
            <div className="md:col-span-2 lg:col-span-1"><TopProducts items={sales.top_products} /></div>
          </div>
        </>
      )}

      {(seesStock || seesGrn) && <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        {seesStock && <Panel title="Running low" lead="Available stock at or below the reorder level" action={<Button to="/app/pharmacy/inventory" variant="ghost" size="sm">See all</Button>}>
          {low.length === 0 ? <EmptyState compact icon={Package} title="Nothing low" body="Every product is above its reorder level." /> : (
            <Table><Thead><Th>Product</Th><Th className="text-right">Available</Th><Th className="text-right">Reorder at</Th></Thead>
              <tbody>{low.slice(0, 8).map((x) => <Tr key={x.product_id}><Td className="font-medium">{x.name}</Td><Td className="text-right tabular font-semibold text-warning">{qty(x.available)} {x.unit}</Td><Td className="text-right tabular text-ink-500">{qty(x.reorder_level)}</Td></Tr>)}</tbody>
            </Table>
          )}
        </Panel>}
        {seesGrn && <Panel title="Recent goods receipts" lead="Direct from suppliers, no purchase order step" action={<Button to="/app/pharmacy/grn" variant="ghost" size="sm">See all</Button>}>
          {!grn.data?.length ? <EmptyState compact icon={ReceiptText} title="Nothing received yet" body="Goods receipts you post will show up here." /> : (
            <Table><Thead><Th>Receipt</Th><Th>Supplier</Th><Th>Date</Th><Th className="text-right">Total</Th></Thead>
              <tbody>{grn.data.map((g) => <Tr key={g.grn_id}><Td className="font-medium">{g.grn_number}</Td><Td className="text-ink-500">{g.supplier}</Td><Td className="text-ink-500">{dateText(g.grn_date)}</Td><Td className="text-right tabular">{money(g.total)}</Td></Tr>)}</tbody>
            </Table>
          )}
        </Panel>}
      </div>}
      {expiry.data?.expired > 0 && (
        <p className="mt-4 flex items-center gap-2 text-small text-ink-500"><TriangleAlert aria-hidden="true" className="h-4 w-4 text-danger" />Expired batches can never be sold, but still count in stock value until you mark them quarantined or blocked from the Inventory screen.</p>
      )}
    </div>
  );
};

export default PharmacyDashboard;
