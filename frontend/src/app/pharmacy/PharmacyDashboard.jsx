/*
 * The pharmacy's front page: expiry and stock alerts, and the last few goods receipts. Built from the same
 * endpoints the Inventory and Goods receipts screens use — there is no separate dashboard endpoint, so what
 * is shown here is always exactly what those screens would show too.
 */
import { Package, Plus, ReceiptText, TriangleAlert } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { dateText, money, qty, useLoad } from '../../lib/pharmacy.js';
import { Alert, Button, EmptyState, PageHeader, SkeletonCards, StatCard, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { Panel } from './parts.jsx';

const PharmacyDashboard = () => {
  const { business, can } = useAuth();
  const expiry = useLoad('/pharmacy/inventory/expiry');
  const stock = useLoad('/pharmacy/inventory/stock?limit=200', { paged: true });
  const grn = useLoad('/pharmacy/grn?limit=5', { paged: true });

  const low = (stock.data || []).filter((r) => r.low);
  // expiry_alert_days is sorted ascending (pharmacy/common.js), so the first bucket is the soonest window
  const expiringSoon = expiry.data?.buckets?.[0]?.batches ?? 0;

  return (
    <div>
      <PageHeader title={business?.name || 'Today'} lead="Stock, expiry and the last few goods receipts, at a glance."
                  action={<>{can('billing') && <Button to="/app/pharmacy/pos"><Plus aria-hidden="true" className="h-4 w-4" />New sale</Button>}{can('purchases') && <Button to="/app/pharmacy/grn" variant="secondary"><Package aria-hidden="true" className="h-4 w-4" />Receive goods</Button>}</>} />
      <Alert>{expiry.error || stock.error || grn.error}</Alert>
      {(expiry.loading && !expiry.data) ? <SkeletonCards count={3} /> : (
        <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard size="lg" to="/app/pharmacy/inventory?tab=batches" label="Expired batches" value={expiry.data?.expired ?? '—'} tone={expiry.data?.expired > 0 ? 'danger' : undefined} note={expiry.data?.expired > 0 ? 'Still showing as stock until pulled' : 'None in stock'} />
          <StatCard size="lg" to="/app/pharmacy/inventory?tab=batches" label="Expiring soon" value={expiringSoon} tone={expiringSoon > 0 ? 'warning' : undefined} note="Within your alert window" />
          <StatCard size="lg" to="/app/pharmacy/inventory" label="Low or out of stock" value={low.length} tone={low.length > 0 ? 'warning' : undefined} note={low.length > 0 ? 'Below reorder level' : 'Above reorder level'} />
        </section>
      )}

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <Panel title="Running low" lead="Available stock at or below the reorder level" action={<Button to="/app/pharmacy/inventory" variant="ghost" size="sm">See all</Button>}>
          {low.length === 0 ? <EmptyState compact icon={Package} title="Nothing low" body="Every product is above its reorder level." /> : (
            <Table><Thead><Th>Product</Th><Th className="text-right">Available</Th><Th className="text-right">Reorder at</Th></Thead>
              <tbody>{low.slice(0, 8).map((x) => <Tr key={x.product_id}><Td className="font-medium">{x.name}</Td><Td className="text-right tabular font-semibold text-warning">{qty(x.available)} {x.unit}</Td><Td className="text-right tabular text-ink-500">{qty(x.reorder_level)}</Td></Tr>)}</tbody>
            </Table>
          )}
        </Panel>
        <Panel title="Recent goods receipts" lead="Direct from suppliers, no purchase order step" action={<Button to="/app/pharmacy/grn" variant="ghost" size="sm">See all</Button>}>
          {!grn.data?.length ? <EmptyState compact icon={ReceiptText} title="Nothing received yet" body="Goods receipts you post will show up here." /> : (
            <Table><Thead><Th>Receipt</Th><Th>Supplier</Th><Th>Date</Th><Th className="text-right">Total</Th></Thead>
              <tbody>{grn.data.map((g) => <Tr key={g.grn_id}><Td className="font-medium">{g.grn_number}</Td><Td className="text-ink-500">{g.supplier}</Td><Td className="text-ink-500">{dateText(g.grn_date)}</Td><Td className="text-right tabular">{money(g.total)}</Td></Tr>)}</tbody>
            </Table>
          )}
        </Panel>
      </div>
      {expiry.data?.expired > 0 && (
        <p className="mt-4 flex items-center gap-2 text-small text-ink-500"><TriangleAlert aria-hidden="true" className="h-4 w-4 text-danger" />Expired batches can never be sold, but still count in stock value until you mark them quarantined or blocked from the Inventory screen.</p>
      )}
    </div>
  );
};

export default PharmacyDashboard;
