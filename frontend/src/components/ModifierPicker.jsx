/*
 * Choose a dish's options (size, add-ons) before it goes on an order or the
 * customer's cart. Shared by the staff order screen, the POS and the customer
 * QR menu so the rules the server enforces (required groups, max choices) are
 * shown the same way everywhere. The server re-checks every choice; this only
 * stops a person submitting something it will refuse.
 *
 * `product.modifier_groups` is [{ group_id, name, is_variant, min_select,
 * max_select, modifiers: [{ modifier_id, name, price_delta }] }].
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Button, Modal } from './ui.jsx';

const formatDelta = (n) => (n === 0 ? '' : `${n > 0 ? '+' : '−'}₹${Math.abs(n)}`);

export const needsChoices = (product) => (product.modifier_groups || []).length > 0;

/* The staff app's product list carries only group ids; this loads the groups
   once and returns a function that attaches them to a product for the picker. */
export const useModifierGroups = () => {
  const [groups, setGroups] = useState([]);
  useEffect(() => { api('/modifier-groups').then(setGroups).catch(() => {}); }, []);
  return (product) => ({ ...product, modifier_groups: groups.filter((g) => (product.modifier_group_ids || []).includes(g.group_id)) });
};

const ModifierPicker = ({ product, onConfirm, onClose }) => {
  const groups = product.modifier_groups || [];
  const [chosen, setChosen] = useState(() => {
    // A required single choice starts on its first option, so "Full" is one tap fewer.
    const start = {};
    for (const g of groups) start[g.group_id] = g.min_select === 1 && g.max_select === 1 && g.modifiers[0] ? [g.modifiers[0].modifier_id] : [];
    return start;
  });

  const toggle = (group, id) => setChosen((c) => {
    const current = c[group.group_id] || [];
    if (group.max_select === 1) return { ...c, [group.group_id]: [id] };
    if (current.includes(id)) return { ...c, [group.group_id]: current.filter((x) => x !== id) };
    if (group.max_select != null && current.length >= group.max_select) return c;
    return { ...c, [group.group_id]: [...current, id] };
  });

  const problem = groups.find((g) => (chosen[g.group_id] || []).length < g.min_select);
  const selected = groups.flatMap((g) => g.modifiers.filter((m) => (chosen[g.group_id] || []).includes(m.modifier_id)));
  const total = Number(product.price ?? product.selling_price ?? 0) + selected.reduce((s, m) => s + m.price_delta, 0);

  return (
    <Modal title={product.name} onClose={onClose}>
      <div className="space-y-5">
        {groups.map((group) => (
          <fieldset key={group.group_id}>
            <legend className="text-sm font-semibold text-ink-900">
              {group.name}
              <span className="ml-2 text-xs font-normal text-ink-400">
                {group.min_select >= 1 ? 'Required' : 'Optional'}
                {group.max_select != null && group.max_select > 1 ? ` · up to ${group.max_select}` : ''}
              </span>
            </legend>
            <div className="mt-2 grid gap-2">
              {group.modifiers.map((m) => {
                const on = (chosen[group.group_id] || []).includes(m.modifier_id);
                return (
                  <button
                    key={m.modifier_id}
                    type="button"
                    onClick={() => toggle(group, m.modifier_id)}
                    aria-pressed={on}
                    className={`flex items-center justify-between rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors ${on ? 'border-brand-500 bg-brand-50 font-medium text-brand-600' : 'border-line-strong bg-surface text-ink-700 hover:bg-surface-2'}`}
                  >
                    <span>{m.name}</span>
                    <span className="text-xs text-ink-500">{formatDelta(m.price_delta)}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}

        <div className="flex items-center justify-between border-t border-line pt-4">
          <span className="text-sm font-semibold text-ink-900">₹{total}</span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="button" disabled={Boolean(problem)} onClick={() => onConfirm(selected.map((m) => m.modifier_id), selected)}>
              {problem ? `Choose ${problem.name}` : 'Add to order'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default ModifierPicker;
