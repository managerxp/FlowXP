/*
 * What a customer usually buys, from their own bills: the sizes and colours they take most. A full section on the customer's page, and a one-line hint at the till once the
 * customer is chosen, so the cashier can say "the black one in M?". Shows nothing when there is nothing to say.
 */
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useT } from '../../i18n/useT.js';

const usePrefs = (customerId) => {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true; setData(null);
    api(`/clothing/customers/${customerId}/preferences`).then((d) => { if (live) setData(d); }).catch(() => { if (live) setData({ pieces: 0 }); });
    return () => { live = false; };
  }, [customerId]);
  return data;
};

const Swatch = ({ hex }) => <span aria-hidden="true" className="mr-1 inline-block h-3 w-3 rounded-full border border-line-strong align-middle" style={{ background: hex || '#e5e7eb' }} />;

/** One line for the till: "Usually buys M, L · Black, Navy". */
export const UsualSizes = ({ customerId }) => {
  const tr = useT();
  const p = usePrefs(customerId);
  if (!p?.pieces) return null;
  return <p className="text-caption text-ink-500">{tr('Usually buys')} <span className="font-medium text-ink-700">{p.sizes.slice(0, 2).map((x) => x.size).join(', ')}</span> · <span className="font-medium text-ink-700">{p.colours.slice(0, 2).map((x) => x.colour).join(', ')}</span></p>;
};

const CustomerSizes = ({ customerId }) => {
  const tr = useT();
  const p = usePrefs(customerId);
  if (!p) return null;
  const chips = (list, label) => (
    <div>
      <p className="mb-1 text-caption text-ink-500">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {list.map((x) => (
          <span key={x.size ?? x.colour ?? x.name} className="tabular inline-flex items-center rounded-full border border-line bg-surface-2 px-2.5 py-1 text-small text-ink-900">
            {x.colour !== undefined && <Swatch hex={x.hex} />}{x.size ?? x.colour ?? x.name}<span className="ml-1.5 text-caption text-ink-500">{x.pieces}</span>
          </span>
        ))}
      </div>
    </div>
  );
  return (
    <section aria-label={tr('Sizes and colours')}>
      <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-ink-500">{tr('Sizes and colours')}</h3>
      {!p.pieces ? <p className="rounded-(--radius-card) border border-dashed border-line-strong p-5 text-center text-small text-ink-500">{tr('No clothing bought yet.')}</p> : (
        <div className="space-y-3 rounded-lg border border-line bg-surface-2 p-3.5">
          {chips(p.sizes, tr('Sizes'))}
          {chips(p.colours, tr('Colours'))}
          {chips(p.styles, tr('Bought most'))}
          <p className="text-caption text-ink-500">{tr('{{n}} pieces on {{b}} bills', { n: p.pieces, b: p.bills })}</p>
        </div>
      )}
    </section>
  );
};

export default CustomerSizes;
