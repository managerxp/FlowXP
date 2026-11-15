/*
 * One front door for putting items into the shop: the question is "what are you doing?", not "which screen?".
 * Each card opens the screen that does it, already in the right place (the add form open, the import open).
 */
import { Link } from 'react-router-dom';
import { Barcode, FileSpreadsheet, PackagePlus, Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { RETAIL_TYPES } from '../lib/business.js';
import { PageHeader } from '../components/ui.jsx';
import { useT } from '../i18n/useT.js';

const AddItemsPage = () => {
  const tr = useT();
  const { business, can, hasFeature } = useAuth();
  const retail = RETAIL_TYPES.includes(business?.business_type);
  const cards = [
    can('products') && { to: '/app/products?add=1', icon: Plus, title: 'Add one new item', body: 'A product you have not entered before: name, price, GST and how many you have.' },
    can('inventory') && { to: '/app/stock/receive', icon: PackagePlus, title: 'Stock has arrived', body: 'Scan the barcodes or pick the items, enter how many came in and what you paid. Items you have never entered can be made right there.' },
    retail && can('inventory') && { to: '/app/stock?import=1', icon: FileSpreadsheet, title: 'Many items at once', body: 'Bring in your whole list from Excel, Tally or Vyapar.' },
    can('products') && hasFeature('barcode_labels') && { to: '/app/barcodes', icon: Barcode, title: 'Print barcode labels', body: 'Give items a barcode of your own and print stickers. Scanning them later finds the right item.' }
  ].filter(Boolean);
  return (
    <div>
      <PageHeader title={tr('Add items')} lead={tr('What are you doing? Pick one.')} />
      <ul className="grid gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <li key={c.to}>
            <Link to={c.to} className="flex h-full gap-4 rounded-xl border border-line bg-surface p-5 hover:border-brand-500">
              <c.icon aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0 text-brand-600" />
              <span><span className="block text-body font-semibold text-ink-900">{tr(c.title)}</span><span className="mt-1 block text-small text-ink-500">{tr(c.body)}</span></span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default AddItemsPage;
