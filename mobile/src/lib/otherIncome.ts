/* Other income: money received that is not a sale (interest, rent received, scrap). Website: Other income. Profit and loss and the day book read it. */
export const INCOME_CATEGORIES = ['Interest', 'Rent received', 'Commission', 'Scrap sale', 'Refund received', 'Other'];
export const INCOME_METHODS: { id: 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER'; label: string }[] = [{ id: 'CASH', label: 'Cash' }, { id: 'UPI', label: 'UPI' }, { id: 'CARD', label: 'Card' }, { id: 'BANK_TRANSFER', label: 'Bank' }];
export type Income = { income_id: number; category: string; amount: number; payment_method: string; income_date: string; description: string | null };
export type IncomeList = { total: number; rows: Income[] };

export const incomeProblem = (category: string, amount: string): string => (!category.trim() ? 'Choose what it was for' : !(Number(amount) > 0) ? 'Enter the amount' : '');
export const incomeBody = (category: string, amount: string, method: string, note: string) => ({ category: category.trim(), amount: Number(amount), payment_method: method, ...(note.trim() ? { description: note.trim() } : {}) });
export const incomeUrl = (from: string, to: string): string => `/other-income?from=${from}&to=${to}`;

export const INCOME_TEXTS = [
  'Other income', 'Interest, rent received, scrap: money in that is not from a bill', 'Received', 'Add income', 'Remove this income?', 'It is taken off your income.', 'Keep it', 'Remove',
  'No income in this time. Tap Add income when you receive money that is not from a bill.', 'Interest', 'Rent received', 'Commission', 'Scrap sale', 'Refund received', 'Other',
  'Choose what it was for', 'Enter the amount', 'What was it for?', 'Received by', 'A note (optional)', 'Save', 'Cancel', 'Amount', 'Cash', 'UPI', 'Card', 'Bank', 'Back'
];
