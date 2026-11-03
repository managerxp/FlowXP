/*
 * Clothing at the till: a style is one tile, and a tap opens its size x colour grid. Each cell is a variant (its own SKU, price and stock);
 * tapping one puts exactly that size and colour on the bill. The grid stays open so a few sizes of one style can be added at once.
 * Scanning a tag does not need this: the barcode is the variant.
 */
import { formatCurrency } from '../../lib/api.js';
import { useLoad } from '../../lib/salon.js';
import { Alert, Button, Modal } from '../../components/ui.jsx';
import { useT } from '../../i18n/useT.js';

const Swatch = ({ hex, name }) => <span title={name} aria-hidden="true" className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-line-strong align-middle" style={{ background: hex || '#e5e7eb' }} />;

export const StyleTile = ({ style, inCart = 0, onOpen }) => {
  const tr = useT();
  const from = style.price_from_paise, to = style.price_to_paise;
  return (
    <button type="button" onClick={() => onOpen(style)} disabled={style.stock <= 0}
            className="relative flex min-h-[88px] flex-col justify-between rounded-(--radius-card) border border-line bg-surface p-3 text-left transition-[border-color,transform] duration-(--duration-fast) hover:border-brand-500 active:scale-[0.98] disabled:opacity-50">
      {inCart > 0 && <span className="tabular absolute right-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-500 px-1.5 text-[11px] font-semibold text-white">{inCart}<span className="sr-only"> {tr('in the bill')}</span></span>}
      <span className="line-clamp-2 pr-6 text-small font-medium leading-snug text-ink-900">{style.name}</span>
      <span className="mt-2 flex flex-wrap items-end justify-between gap-x-2 gap-y-0.5">
        <span className="tabular shrink-0 text-small font-semibold text-ink-900">{from === to ? formatCurrency(from / 100) : `${formatCurrency(from / 100)}+`}</span>
        <span className={`ml-auto text-right text-[11px] leading-tight ${style.stock <= 0 ? 'font-medium text-danger' : 'text-ink-500'}`}>
          {style.stock <= 0 ? tr('Sold out') : tr('{{n}} in {{c}} colours', { n: style.stock, c: (style.colours || []).length })}
        </span>
      </span>
    </button>
  );
};

/** onAdd gets the variant shaped like a till product. inCart is a Map of product_id to how many are on the bill already. */
export const StylePicker = ({ styleId, inCart, onAdd, onClose }) => {
  const tr = useT();
  const { data: s, error, loading } = useLoad(`/clothing/styles/${styleId}`);
  const shape = (colour, size, cell) => ({
    product_id: cell.product_id, name: `${s.name} · ${colour} · ${size}`, sku: cell.sku, unit: 'pc', selling_price: cell.selling_price_paise / 100,
    tax_rate: Number(s.tax_rate), track_inventory: true, current_stock: cell.stock
  });
  return (
    <Modal wide title={s ? s.name : tr('Style')} onClose={onClose} footer={<Button onClick={onClose}>{tr('Done')}</Button>}>
      {loading && !s && <p className="text-small text-ink-500">{tr('Loading…')}</p>}
      <Alert>{error}</Alert>
      {s && (
        <div className="space-y-3">
          <p className="text-small text-ink-500">{s.style_code} · {tr('Tap a size to add it to the bill.')}</p>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-small">
              <thead><tr className="bg-surface-2 text-left text-caption text-ink-500"><th className="px-3 py-2 font-semibold">{tr('Colour')}</th>{s.matrix.sizes.map((z) => <th key={z} className="px-2 py-2 text-center font-semibold">{z}</th>)}</tr></thead>
              <tbody>
                {s.matrix.colours.map((c) => (
                  <tr key={c.name} className="border-t border-line">
                    <td className="whitespace-nowrap px-3 py-2 font-medium"><Swatch hex={c.hex} name={c.name} /> <span className="ml-1">{c.name}</span></td>
                    {s.matrix.sizes.map((z) => {
                      const cell = s.matrix.grid[c.name]?.[z];
                      if (!cell) return <td key={z} className="px-2 py-1.5 text-center text-ink-300">–</td>;
                      const have = inCart.get(cell.product_id) || 0;
                      const out = cell.stock - have <= 0;
                      return (
                        <td key={z} className="px-1.5 py-1.5 text-center">
                          <button type="button" disabled={out} onClick={() => onAdd(shape(c.name, z, cell))} aria-label={`${c.name} ${z}`}
                                  className={`relative min-h-11 min-w-11 rounded-lg border px-2 py-1 tabular transition-colors disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-2 disabled:text-ink-300 ${have ? 'border-brand-500 bg-brand-50' : 'border-line-strong hover:border-brand-500'} ${!out && cell.low ? 'text-warning' : ''}`}>
                            <span className="block text-small font-semibold">{cell.stock - have}</span>
                            {have > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-500 px-1 text-[11px] font-semibold text-white">{have}</span>}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-caption text-ink-500">{tr('The number is what is left to sell here. Amber is running low.')}</p>
        </div>
      )}
    </Modal>
  );
};
