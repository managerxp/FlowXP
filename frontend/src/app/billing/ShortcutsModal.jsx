/* The till's shortcut list as a popup (F1, ?, or the Shortcuts button), and the small key label shown beside a button that has a shortcut. */
import { Button, Modal } from '../../components/ui.jsx';
import { TILL_KEYS } from '../../lib/tillShortcuts.js';
import { useT } from '../../i18n/useT.js';

/** The key a button answers to. Hidden on a touch screen, where there is no keyboard to press it on. */
export const Kbd = ({ children, className = '' }) => (
  <kbd className={`hidden rounded border border-line-strong bg-surface-2 px-1 text-[10px] font-semibold leading-4 text-ink-500 lg:inline ${className}`}>{children}</kbd>
);

/** A shop's till has all of them; a restaurant counter has the few that apply there. */
const COUNTER = new Set(['F1', '/', 'Ctrl + Enter', 'Esc']);
const ShortcutsModal = ({ onClose, shop = true }) => {
  const tr = useT();
  return (
    <Modal title={tr('Keyboard shortcuts')} onClose={onClose} footer={<Button onClick={onClose}>{tr('Done')}</Button>}>
      <ul className="divide-y divide-line">
        {TILL_KEYS.filter(([key]) => shop || COUNTER.has(key)).map(([key, what]) => (
          <li key={`${key}-${what}`} className="flex items-center justify-between gap-4 py-2">
            <span className="text-small text-ink-900">{tr(what)}</span>
            <kbd className="tabular shrink-0 rounded-md border border-line-strong bg-surface-2 px-2 py-0.5 text-caption font-semibold text-ink-700">{key}</kbd>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-caption text-ink-500">{tr('Press F1 any time to see this list.')}</p>
    </Modal>
  );
};

export default ShortcutsModal;
