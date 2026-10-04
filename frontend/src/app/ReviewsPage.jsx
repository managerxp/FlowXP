/*
 * Feedback captured on the public bill page after a sale (backend: migration
 * 0045, publicBill.controller.js). A happy rating (4-5) was already asked to
 * post it on Google; an unhappy one lands here, private, for the owner to see
 * and reply to — Flow AI can draft that reply, the owner reviews it (and can
 * edit it) before it's ever sent.
 */
import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { api } from '../lib/api.js';
import { Alert, Badge, Button, Card, Field, ListState, PageHeader, Select, Textarea, useToast } from '../components/ui.jsx';

const Stars = ({ rating }) => (
  <span className="flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
    {[1, 2, 3, 4, 5].map((n) => (
      <Star key={n} aria-hidden="true" className={`h-4 w-4 ${n <= rating ? 'fill-warning text-warning' : 'text-line-strong'}`} />
    ))}
  </span>
);

const when = (iso) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const FeedbackCard = ({ row, onReplied }) => {
  const toast = useToast();
  const [reply, setReply] = useState(row.reply_text || '');
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const replied = Boolean(row.reply_sent_at);

  const draft = async () => {
    setDrafting(true); setError('');
    try {
      const result = await api(`/reviews/${row.feedback_id}/draft-reply`, { method: 'POST' });
      setReply(result.reply);
    } catch (caught) { setError(caught.message); }
    finally { setDrafting(false); }
  };

  const send = async () => {
    setSending(true); setError('');
    try {
      await api(`/reviews/${row.feedback_id}/reply`, { method: 'POST', body: { text: reply } });
      toast.success('Reply sent');
      onReplied();
    } catch (caught) { setError(caught.message); }
    finally { setSending(false); }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Stars rating={row.rating} />
          <p className="mt-1 text-xs text-ink-400">{row.customer_name || 'A customer'} · {row.invoice_number} · {when(row.created_at)}</p>
        </div>
        {replied && <Badge tone="success">Replied</Badge>}
      </div>
      {row.comment && <p className="mt-3 text-sm text-ink-900">“{row.comment}”</p>}
      {!row.comment && <p className="mt-3 text-sm text-ink-400">No comment left.</p>}

      {error && <div className="mt-3"><Alert>{error}</Alert></div>}

      {replied ? (
        <p className="mt-3 rounded-lg bg-surface-2 p-3 text-sm text-ink-700">{row.reply_text}</p>
      ) : (
        <div className="mt-3 space-y-2">
          <Textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply, or let Flow AI draft one…" maxLength={1000} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={draft} disabled={drafting}>{drafting ? 'Drafting…' : 'Draft with Flow AI'}</Button>
            <Button size="sm" onClick={send} disabled={sending || !reply.trim()}>{sending ? 'Sending…' : 'Send reply'}</Button>
          </div>
        </div>
      )}
    </Card>
  );
};

const ReviewsPage = () => {
  const [rows, setRows] = useState(null);
  const [rating, setRating] = useState('');
  const [error, setError] = useState('');

  const load = (r = rating) => api(`/reviews${r ? `?rating=${r}` : ''}`).then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(''); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const changeFilter = (r) => { setRating(r); setRows(null); load(r); };

  const average = rows?.length ? (rows.reduce((sum, r) => sum + r.rating, 0) / rows.length).toFixed(1) : null;

  return (
    <div>
      <PageHeader
        title="Reviews"
        lead={average ? `Average ${average} out of 5, from ${rows.length} rating${rows.length === 1 ? '' : 's'} shown below.` : 'Ratings and comments customers leave after their bill.'}
      />
      <div className="mb-4 max-w-xs">
        <Field id="rating-filter" label="Show">
          <Select id="rating-filter" value={rating} onChange={(e) => changeFilter(e.target.value)}>
            <option value="">Every rating</option>
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} stars</option>)}
          </Select>
        </Field>
      </div>

      <ListState loading={!rows && !error} error={error} empty={rows?.length === 0} emptyLabel="No feedback yet — it appears here once a customer rates their bill." />
      {rows?.length > 0 && (
        <div className="space-y-4">
          {rows.map((row) => <FeedbackCard key={row.feedback_id} row={row} onReplied={() => load()} />)}
        </div>
      )}
    </div>
  );
};

export default ReviewsPage;
