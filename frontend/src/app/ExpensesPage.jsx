/*
 * Expenses: the plainest page in the app, matching the plainest controller.
 */
import { useEffect, useState } from 'react';
import { api, formatCurrency } from '../lib/api.js';
import { daysAgoISO } from '../lib/dates.js';
import { Alert, Button, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Th, Thead, Tr } from '../components/ui.jsx';

const CATEGORIES = ['Rent', 'Salary', 'Utilities', 'Transport', 'Marketing', 'Maintenance', 'Other'];
const emptyForm = { category: 'Rent', amount: '', payment_method: 'CASH', expense_date: daysAgoISO(0), description: '' };

const ExpenseForm = ({ onSaved, onClose }) => {
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api('/expenses', { method: 'POST', body: form });
      onSaved();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Log an expense" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="category" label="Category">
            <Select id="category" value={form.category} onChange={set('category')}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field id="amount" label="Amount (₹)">
            <Input id="amount" type="number" min="0.01" step="0.01" value={form.amount} onChange={set('amount')} required autoFocus />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="payment_method" label="Paid via">
            <Select id="payment_method" value={form.payment_method} onChange={set('payment_method')}>
              {['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'].map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
            </Select>
          </Field>
          <Field id="expense_date" label="Date">
            <Input id="expense_date" type="date" value={form.expense_date} onChange={set('expense_date')} />
          </Field>
        </div>
        <Field id="description" label="Note" hint="Optional">
          <Input id="description" value={form.description} onChange={set('description')} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Log expense'}</Button>
        </div>
      </form>
    </Modal>
  );
};

const ExpensesPage = () => {
  const [expenses, setExpenses] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const load = async () => {
    try { setExpenses(await api('/expenses')); } catch (caught) { setError(caught.message); }
  };
  useEffect(() => { load(); }, []);

  const remove = async (expense) => {
    if (!confirm('Delete this expense?')) return;
    await api(`/expenses/${expense.expense_id}`, { method: 'DELETE' });
    load();
  };

  const total = expenses?.reduce((sum, e) => sum + e.amount, 0) ?? 0;

  return (
    <div>
      <PageHeader title="Expenses" lead="Rent, salary, utilities and the rest — so profit is a real number." action={<Button onClick={() => setAdding(true)}>Log expense</Button>} />

      {expenses?.length > 0 && (
        <div className="mb-5 glass inline-block rounded-[--radius-card] px-5 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">Total (recent)</span>{' '}
          <span className="text-lg font-bold text-ink-900">{formatCurrency(total)}</span>
        </div>
      )}

      <ListState loading={!expenses && !error} error={error} empty={expenses?.length === 0} emptyLabel="No expenses logged yet." />

      {expenses?.length > 0 && (
        <Table>
          <Thead><Th>Date</Th><Th>Category</Th><Th>Note</Th><Th>Paid via</Th><Th className="text-right">Amount</Th><Th></Th></Thead>
          <tbody>
            {expenses.map((e) => (
              <Tr key={e.expense_id}>
                <Td className="text-ink-500">{e.expense_date}</Td>
                <Td className="font-medium">{e.category}</Td>
                <Td className="text-ink-500">{e.description || '—'}</Td>
                <Td className="text-ink-500">{e.payment_method.replace('_', ' ')}</Td>
                <Td className="text-right font-semibold">{formatCurrency(e.amount)}</Td>
                <Td className="text-right"><button onClick={() => remove(e)} className="text-xs font-semibold text-ink-400 hover:text-danger">Delete</button></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      {adding && <ExpenseForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </div>
  );
};

export default ExpensesPage;
