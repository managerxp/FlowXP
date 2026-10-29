import { useState } from 'react';
import { inr, statusTone } from './lib.js';

export const Page = ({ title, lead, actions, children }) => (
  <div className="page">
    <div className="page-head">
      <div><h1>{title}</h1>{lead && <p className="lead">{lead}</p>}</div>
      {actions && <div className="actions">{actions}</div>}
    </div>
    {children}
  </div>
);

export const Card = ({ title, actions, children, className = '' }) => (
  <section className={`card ${className}`}>
    {(title || actions) && <div className="card-head">{title && <h2>{title}</h2>}{actions && <div className="actions">{actions}</div>}</div>}
    {children}
  </section>
);

export const Err = ({ children }) => (children ? <p className="notice bad" role="alert">{children}</p> : null);
export const Note = ({ children }) => (children ? <p className="notice ok" role="status">{children}</p> : null);
export const Loading = () => <p className="muted pad">Loading…</p>;
export const Empty = ({ children }) => <p className="muted pad">{children}</p>;

/** Shows the loading or error state, or the content. */
export const Async = ({ load, children }) => (load.error ? <Err>{load.error}</Err> : load.loading && !load.data ? <Loading /> : load.data ? children(load.data) : null);

export const Badge = ({ status, children }) => <span className={`badge ${statusTone(status)}`}>{children ?? String(status).replaceAll('_', ' ').toLowerCase()}</span>;
export const Money = ({ v, strong }) => <span className={`num ${strong ? 'strong' : ''}`}>₹{inr(v)}</span>;

export const Field = ({ label, hint, children, wide }) => (
  <label className={`field ${wide ? 'wide' : ''}`}><span className="label">{label}</span>{children}{hint && <span className="hint">{hint}</span>}</label>
);

export const Btn = ({ kind = '', busy, children, ...rest }) => <button className={`btn ${kind}`} disabled={busy || rest.disabled} {...rest}>{busy ? 'Please wait…' : children}</button>;

export const Table = ({ head, children, empty }) => (
  <div className="scroll">
    <table>
      <thead><tr>{head.map((h, i) => <th key={i} className={String(h).startsWith('>') ? 'r' : ''}>{String(h).replace(/^>/, '')}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
    {empty}
  </div>
);

/** Tabs kept in the page, not the address, so a refresh keeps it simple. */
export const Tabs = ({ tabs, value, onChange }) => (
  <div className="tabs" role="tablist">{tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{label}</button>)}</div>
);

/** A run-an-action helper: shows busy state and the error or success message. */
export const useAction = () => {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [done, setDone] = useState('');
  const run = async (fn, message = '') => {
    setBusy(true); setError(''); setDone('');
    try { const out = await fn(); if (message) setDone(message); return out; } catch (e) { setError(e.message); return undefined; } finally { setBusy(false); }
  };
  return { busy, error, done, run, setError, setDone };
};

export const Confirm = ({ children }) => <div className="confirm">{children}</div>;
