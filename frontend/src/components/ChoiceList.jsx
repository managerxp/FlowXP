/* A short list an owner builds mostly by tapping: ready suggestions to switch on, plus a box for their own. */
import { useState } from 'react';
import { Button, Input } from './ui.jsx';

export default function ChoiceList({ id, label, hint, value, suggestions, max, onChange }) {
  const [own, setOwn] = useState('');
  const all = [...new Set([...value, ...suggestions])];
  const full = value.length >= max;
  const toggle = (name) => onChange(value.includes(name) ? value.filter((v) => v !== name) : [...value, name]);
  const add = () => { const name = own.trim(); if (name && !value.includes(name) && !full) onChange([...value, name]); setOwn(''); };
  return (
    <fieldset className="space-y-2">
      <legend className="text-small font-medium text-ink-900">{label}</legend>
      <p className="text-caption text-ink-500">{hint}</p>
      <div className="flex flex-wrap gap-1.5">
        {all.map((name) => {
          const on = value.includes(name);
          return <button key={name} type="button" aria-pressed={on} disabled={!on && full} onClick={() => toggle(name)}
                         className={`rounded-full border px-3 py-1.5 text-small font-medium disabled:opacity-50 ${on ? 'border-brand-500 bg-brand-500 text-white' : 'border-line-strong bg-surface text-ink-900'}`}>{name}</button>;
        })}
      </div>
      <div className="flex gap-2">
        <div className="flex-1"><Input id={id} aria-label={`Add your own: ${label}`} placeholder="Add your own" maxLength={40} value={own} onChange={(e) => setOwn(e.target.value)}
                                       onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} /></div>
        <Button type="button" variant="secondary" onClick={add} disabled={!own.trim() || full}>Add</Button>
      </div>
    </fieldset>
  );
}
