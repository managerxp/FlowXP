/*
 * A live sample of the thermal receipt, drawn from the receipt settings as they are being edited (before saving): paper width, logo, header line,
 * which lines show, footer, blank lines and the cut. The markup follows the real receipt in PrintPages.jsx so what is seen here is what prints.
 */
import { useT } from '../i18n/useT.js';

const PAPER = { 58: 'w-[58mm]', 80: 'w-[80mm]' };
const ROWS = 'grid-cols-[1fr_auto_auto_auto] gap-x-2';
const Rule = () => <div className="my-2 border-t border-dashed border-ink-400" />;
const Row = ({ left, right, bold }) => <div className={`flex justify-between gap-2 ${bold ? 'font-bold' : ''}`}><span>{left}</span><span className="shrink-0">{right}</span></div>;

const ITEMS = [['Masala dosa', 2, 80, 160], ['Filter coffee', 1, 40, 40]];

const ReceiptPreview = ({ s, biz }) => {
  const tr = useT();
  const width = Number(s.paper_width) === 58 ? 58 : 80;
  const gstin = biz?.gstin || '29ABCDE1234F1Z5';
  const showTax = s.show_tax_lines !== false;
  const totalQty = ITEMS.reduce((n, i) => n + i[1], 0);
  const lines = Math.max(0, Math.min(10, Number(s.extra_lines ?? 3)));
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-ink-900">{tr('Preview')}</p>
      <div className="overflow-x-auto rounded-lg bg-surface-2 p-3">
        <div className={`mx-auto rounded-sm border border-line bg-white p-3 font-mono text-[11px] leading-snug text-black shadow-sm ${PAPER[width]}`} aria-label={tr('Preview')}>
          <div className="text-center">
            {s.show_logo !== false && s.logo_url && <img src={s.logo_url} alt="" className="mx-auto mb-1 max-h-16 max-w-[70%] object-contain grayscale contrast-150" />}
            <p className="text-sm font-bold uppercase">{biz?.name || 'Your business'}</p>
            {biz?.address && <p>{[biz.address, biz.city].filter(Boolean).join(', ')}</p>}
            {s.header_text && <p>{s.header_text}</p>}
            {s.show_phone !== false && <p>Ph: {biz?.phone || '98765 43210'}</p>}
            {s.show_gstin && <p>GSTIN: {gstin}</p>}
          </div>
          <Rule />
          <Row left="Bill INV-0042" right="20 Nov 2026" />
          <p>Served by Asha</p>
          <Rule />
          <div className={`grid ${ROWS} font-bold`}><span>Item</span><span className="text-right">Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span></div>
          <Rule />
          {ITEMS.map(([name, qty, rate, amount]) => (
            <div key={name} className={`mt-1 grid ${ROWS}`}>
              <span className="break-words">{name}{s.show_hsn === true && <span className="block text-[0.9em]">HSN 9963</span>}</span>
              <span className="text-right">{qty}</span><span className="text-right">{rate.toFixed(2)}</span><span className="text-right">{amount.toFixed(2)}</span>
            </div>))}
          <Rule />
          <Row left={`Items: ${ITEMS.length}`} right={s.show_total_qty === false ? '' : `Total Qty: ${totalQty}`} />
          <Rule />
          {showTax && <><Row left="Subtotal" right="200.00" /><Row left="CGST" right="5.00" /><Row left="SGST" right="5.00" /></>}
          <Rule />
          <div className="text-sm"><Row left="TOTAL" right="₹210.00" bold /></div>
          {s.show_amount_words === true && <p className="mt-1">Two Hundred Ten Rupees Only</p>}
          <Row left="Paid (Cash)" right="210.00" />
          {s.show_upi_qr && (
            <div className="mt-2 text-center"><div className="mx-auto grid h-20 w-20 place-items-center border border-dashed border-ink-400 text-[10px]">UPI QR</div><p>Scan to pay the balance</p></div>)}
          {s.show_terms === true && s.terms && <><Rule /><p className="whitespace-pre-line">Terms: {s.terms}</p></>}
          {s.footer && <><Rule /><p className="whitespace-pre-line text-center">{s.footer}</p></>}
          {s.show_powered_by !== false && <p className="mt-2 text-center text-[10px]">Powered by FlowXP</p>}
          <div aria-hidden style={{ height: `${lines}em` }} />
          {s.auto_cut && <div className="border-t border-dashed border-ink-400 pt-1 text-center text-[10px] text-ink-500">✂</div>}
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-500">{`${width} mm`}{Number(s.copies) > 1 ? ` · ×${s.copies}` : ''}</p>
    </div>
  );
};

export default ReceiptPreview;
