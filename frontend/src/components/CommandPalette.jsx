/*
 * "Go to…" — a quick switcher over the screens this person can open.
 * Ctrl K / ⌘ K anywhere in the app, or the search box in the top bar.
 * Arrow keys move, Enter opens, Escape closes. Only navigation for now;
 * searching products, customers and bills can plug into the same list.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Search } from 'lucide-react';

const CommandPalette = ({ open, onClose, items }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  /* Best matches first: the name starts with it, then a word in the name
     does, then the name contains it; the group name only when nothing else does. */
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    const score = (i) => {
      const label = i.label.toLowerCase();
      if (label.startsWith(q)) return 0;
      if (label.split(/[\s&]+/).some((w) => w.startsWith(q))) return 1;
      if (label.includes(q)) return 2;
      return -1;
    };
    const ranked = items.map((i) => [score(i), i]).filter(([sc]) => sc >= 0).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
    return ranked.length ? ranked : items.filter((i) => (i.group || '').toLowerCase().includes(q));
  }, [items, query]);

  useEffect(() => { if (open) { setQuery(''); setActive(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);
  useEffect(() => { setActive(0); }, [query]);

  if (!open) return null;

  const go = (item) => { onClose(); navigate(item.to); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); go(results[active]); }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-ink-900/30 p-4 pt-[12vh]" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Go to a screen" onMouseDown={(e) => e.stopPropagation()}
           className="fade-in w-full max-w-lg overflow-hidden rounded-(--radius-panel) border border-line bg-surface shadow-lg">
        <div className="flex items-center gap-3 border-b border-line px-4 transition-colors focus-within:border-brand-500">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Go to… billing, stock, GST, staff"
            aria-label="Search screens"
            aria-controls="palette-results"
            aria-activedescendant={results[active] ? `palette-${active}` : undefined}
            className="palette-input h-12 w-full bg-transparent text-body text-ink-900 placeholder:text-ink-400 focus:outline-none"
          />
          <kbd className="hidden rounded border border-line px-1.5 py-0.5 text-caption text-ink-500 sm:block">Esc</kbd>
        </div>
        <ul id="palette-results" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-6 text-center text-small text-ink-500">No screen called “{query}”.</li>}
          {results.map((item, i) => {
            const Icon = item.icon;
            return (
              <li key={item.to} id={`palette-${i}`} role="option" aria-selected={i === active}
                  onMouseEnter={() => setActive(i)} onClick={() => go(item)}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-small ${i === active ? 'bg-brand-50 text-ink-900' : 'text-ink-700'}`}>
                {Icon && <Icon aria-hidden="true" className={`h-4 w-4 shrink-0 ${i === active ? 'text-brand-600' : 'text-ink-400'}`} />}
                <span className="flex-1">{item.label}</span>
                {item.group && <span className="text-caption text-ink-400">{item.group}</span>}
                {i === active && <CornerDownLeft aria-hidden="true" className="h-3.5 w-3.5 text-ink-400" />}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

export default CommandPalette;
