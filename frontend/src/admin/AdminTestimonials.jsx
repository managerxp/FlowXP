/*
 * Client reviews for the home page. Write the review, upload the person's photo and the company's logo, set the stars and
 * publish it: the home page shows published reviews in this order. A draft stays here until it is published.
 */
import { useEffect, useRef, useState } from 'react';
import { adminApi } from '../lib/adminApi.js';
import { PageHeader, Card, Field, Input, Select, Textarea, Button, Alert, Badge, useToast } from '../components/ui.jsx';

const blank = { name: '', role: '', company: '', quote: '', rating: 5 };

/* One picture slot: shows what is there, uploads a new one on choosing a file, removes it. */
const Picture = ({ label, shape, url, onUpload, onRemove, busy }) => {
  const input = useRef(null);
  return (
    <div className="flex items-center gap-3">
      <div className={`flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden border border-line bg-surface-2 ${shape === 'round' ? 'rounded-full' : 'rounded-lg'}`}>
        {url ? <img src={url} alt="" className={shape === 'round' ? 'h-full w-full object-cover' : 'max-h-full max-w-full object-contain p-1'} /> : <span className="text-xs text-ink-400">None</span>}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-800">{label}</p>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onUpload(f); }} />
        <div className="mt-1 flex gap-3 text-sm">
          <button type="button" disabled={busy} className="font-medium text-brand-600 hover:underline disabled:opacity-50" onClick={() => input.current?.click()}>{url ? 'Replace' : 'Upload'}</button>
          {url && <button type="button" disabled={busy} className="text-danger hover:underline disabled:opacity-50" onClick={onRemove}>Remove</button>}
        </div>
      </div>
    </div>
  );
};

const Stars = ({ n }) => <span aria-label={`${n} stars`} className="text-warning">{'★'.repeat(n)}<span className="text-line-strong">{'★'.repeat(5 - n)}</span></span>;

const Row = ({ item, onChanged }) => {
  const toast = useToast();
  const [f, setF] = useState({ name: item.name, role: item.role || '', company: item.company || '', quote: item.quote, rating: item.rating, sort_order: item.sort_order });
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF({ name: item.name, role: item.role || '', company: item.company || '', quote: item.quote, rating: item.rating, sort_order: item.sort_order }); }, [item]);
  const dirty = ['name', 'role', 'company', 'quote', 'rating', 'sort_order'].some((k) => String(f[k] ?? '') !== String(item[k] ?? ''));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const run = async (fn, done) => { setBusy(true); try { await fn(); if (done) toast.success(done); await onChanged(); } catch (err) { toast.error(err.message); } finally { setBusy(false); } };
  const save = () => run(() => adminApi(`/testimonials/${item.testimonial_id}`, { method: 'PATCH', body: { ...f, rating: Number(f.rating), sort_order: Number(f.sort_order) } }), 'Saved');
  const publish = () => run(() => adminApi(`/testimonials/${item.testimonial_id}`, { method: 'PATCH', body: { is_published: !item.is_published } }), item.is_published ? 'Hidden from the home page' : 'Published on the home page');
  const upload = (kind) => (file) => run(async () => { const body = new FormData(); body.append('image', file); await adminApi(`/testimonials/${item.testimonial_id}/image/${kind}`, { method: 'POST', body }); }, 'Picture saved');
  const removePic = (kind) => () => run(() => adminApi(`/testimonials/${item.testimonial_id}/image/${kind}`, { method: 'DELETE' }));
  const del = () => { if (window.confirm(`Delete ${item.name}’s review for good?`)) run(() => adminApi(`/testimonials/${item.testimonial_id}`, { method: 'DELETE' }), 'Deleted'); };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><Stars n={item.rating} /><Badge tone={item.is_published ? 'success' : 'neutral'}>{item.is_published ? 'On the home page' : 'Draft'}</Badge></div>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={busy} onClick={publish}>{item.is_published ? 'Hide' : 'Publish'}</Button>
          <Button variant="secondary" disabled={busy} onClick={del}>Delete</Button>
        </div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Picture label="Client photo" shape="round" url={item.photo_url} busy={busy} onUpload={upload('photo')} onRemove={removePic('photo')} />
        <Picture label="Company logo" shape="square" url={item.logo_url} busy={busy} onUpload={upload('logo')} onRemove={removePic('logo')} />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Field id={`n${item.testimonial_id}`} label="Name"><Input id={`n${item.testimonial_id}`} value={f.name} onChange={set('name')} maxLength={120} /></Field>
        <Field id={`r${item.testimonial_id}`} label="Role"><Input id={`r${item.testimonial_id}`} value={f.role} onChange={set('role')} maxLength={120} placeholder="Owner" /></Field>
        <Field id={`c${item.testimonial_id}`} label="Company"><Input id={`c${item.testimonial_id}`} value={f.company} onChange={set('company')} maxLength={160} /></Field>
      </div>
      <Field id={`q${item.testimonial_id}`} label="Review" hint={`${f.quote.length} of 600 characters`}><Textarea id={`q${item.testimonial_id}`} rows={3} value={f.quote} onChange={set('quote')} maxLength={600} /></Field>
      <div className="mt-3 grid items-end gap-3 sm:grid-cols-3">
        <Field id={`s${item.testimonial_id}`} label="Stars"><Select id={`s${item.testimonial_id}`} value={f.rating} onChange={set('rating')}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
        <Field id={`o${item.testimonial_id}`} label="Order (smaller shows first)"><Input id={`o${item.testimonial_id}`} type="number" value={f.sort_order} onChange={set('sort_order')} /></Field>
        <Button disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</Button>
      </div>
    </Card>
  );
};

const AdminTestimonials = () => {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const load = () => adminApi('/testimonials').then(setItems).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const add = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await adminApi('/testimonials', { method: 'POST', body: { ...f, rating: Number(f.rating) } }); setF(blank); toast.success('Review added as a draft. Add the pictures and publish it.'); await load(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title="Client reviews" lead="What owners say about FlowXP, shown on the home page with their photo and company logo. A new review starts as a draft until you publish it." />
      <Alert>{error}</Alert>
      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-400">Add a review</h2>
        <form onSubmit={add} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="t-name" label="Name"><Input id="t-name" value={f.name} onChange={set('name')} required maxLength={120} /></Field>
            <Field id="t-role" label="Role"><Input id="t-role" value={f.role} onChange={set('role')} maxLength={120} placeholder="Owner" /></Field>
            <Field id="t-company" label="Company"><Input id="t-company" value={f.company} onChange={set('company')} maxLength={160} /></Field>
          </div>
          <Field id="t-quote" label="Review"><Textarea id="t-quote" rows={3} value={f.quote} onChange={set('quote')} required maxLength={600} /></Field>
          <div className="flex items-end gap-3">
            <Field id="t-stars" label="Stars"><Select id="t-stars" value={f.rating} onChange={set('rating')}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
            <Button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add review'}</Button>
          </div>
        </form>
      </Card>
      {!items && !error && <p className="text-sm text-ink-400">Loading…</p>}
      {items?.length === 0 && <p className="text-sm text-ink-500">No reviews yet. Add the first one above.</p>}
      <div className="space-y-4">{(items || []).map((it) => <Row key={it.testimonial_id} item={it} onChanged={load} />)}</div>
    </div>
  );
};

export default AdminTestimonials;
