/*
 * A text box that suggests as you type, and lists everything when you tap it empty: for the vehicle company and model. Tap a suggestion to take it, or just keep typing:
 * nothing here forces a choice. Plain list, large rows, works with a thumb and with a keyboard (arrows, Enter, Escape).
 */
import { useId, useState } from 'react';
import { Input } from '../../components/ui.jsx';

export default function Suggest({ id, value, onChange, options, placeholder, maxLength, label }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(-1);
  const listId = useId();
  const q = value.trim().toLowerCase();
  const shown = (q ? [...options.filter((o) => o.toLowerCase().startsWith(q)), ...options.filter((o) => !o.toLowerCase().startsWith(q) && o.toLowerCase().includes(q))] : options).slice(0, 60);
  const exact = shown.length === 1 && shown[0].toLowerCase() === q;
  const pick = (name) => { onChange(name); setOpen(false); setAt(-1); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setAt((i) => Math.min(shown.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && open && at >= 0 && shown[at]) { e.preventDefault(); pick(shown[at]); }
    else if (e.key === 'Escape') setOpen(false);
  };
  return (
    <div className="relative">
      <Input id={id} role="combobox" aria-expanded={open && shown.length > 0 && !exact} aria-controls={listId} aria-autocomplete="list" autoComplete="off" value={value} placeholder={placeholder} maxLength={maxLength}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setAt(-1); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKey} />
      {open && shown.length > 0 && !exact && (
        <ul id={listId} role="listbox" aria-label={label} className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-line-strong bg-surface py-1 shadow-lg">
          {shown.map((name, i) => (
            <li key={name} role="option" aria-selected={i === at}
              onMouseDown={(e) => { e.preventDefault(); pick(name); }}
              className={`cursor-pointer px-3 py-3 text-body text-ink-900 ${i === at ? 'bg-brand-50' : 'hover:bg-surface-2'}`}>{name}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
