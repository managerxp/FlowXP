/* Every credit note issued, newest first, with a link back to its invoice and to the printable note. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatCurrency } from '../../lib/api.js';
import { openPrint } from '../../lib/printing.js';
import { Button, ListState, PageHeader, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { useT } from '../../i18n/useT.js';

const CreditNotesPage = () => {
  const tr = useT();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/credit-notes').then(setRows).catch((e) => setError(e.message)); }, []);

  return (
    <div>
      <PageHeader title={tr('Credit notes')} lead={tr('Returns and corrections issued against invoices. They reduce revenue and GST.')} action={<Button variant="secondary" to="/app/billing/invoices">{tr('← Invoices')}</Button>} />
      <ListState loading={!rows && !error} error={error} empty={rows?.length === 0} emptyLabel={tr('No credit notes yet. Open an invoice and choose Issue credit note.')} />
      {rows?.length > 0 && (
        <Table>
          <Thead><Th>{tr('Credit note')}</Th><Th>{tr('Date')}</Th><Th>{tr('Invoice')}</Th><Th>{tr('Customer')}</Th><Th>{tr('Reason')}</Th><Th className="text-right">{tr('Tax')}</Th><Th className="text-right">{tr('Total')}</Th><Th /></Thead>
          <tbody>
            {rows.map((c) => (
              <Tr key={c.cn_id}>
                <Td className="font-medium">{c.cn_number}</Td>
                <Td className="text-ink-500">{String(c.date).slice(0, 10)}</Td>
                <Td><Link to={`/app/billing/invoices/${c.invoice_id}`} className="font-semibold text-brand-600">{c.invoice_number}</Link></Td>
                <Td>{c.customer_name || '—'}</Td>
                <Td className="max-w-56 truncate text-ink-500">{c.reason}</Td>
                <Td className="text-right text-ink-500">{formatCurrency(c.tax)}</Td>
                <Td className="text-right font-medium">{formatCurrency(c.total)}</Td>
                <Td className="text-right"><button onClick={() => openPrint('credit-note', c.cn_id)} className="text-xs font-semibold text-brand-600">{tr('Print')}</button></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
};

export default CreditNotesPage;
