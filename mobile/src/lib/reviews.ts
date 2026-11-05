/* Customer ratings and comments left after a bill (website: Reviews). The owner can let Flow AI draft a reply, edit it, and send it by WhatsApp or SMS. */
export type Review = { feedback_id: number; rating: number; comment: string | null; reply_text: string | null; reply_sent_at: string | null; created_at: string; invoice_number: string; customer_name: string | null };

export const RATING_FILTERS = ['', '5', '4', '3', '2', '1'];
export const reviewsUrl = (rating: string): string => `/reviews${rating ? `?rating=${rating}` : ''}`;
/** The average over the rows shown, one decimal; null when there are none. */
export const averageRating = (rows: Review[]): string | null => (rows.length ? (rows.reduce((n, r) => n + r.rating, 0) / rows.length).toFixed(1) : null);
export const stars = (n: number): string => '★'.repeat(Math.max(0, Math.min(5, n))) + '☆'.repeat(5 - Math.max(0, Math.min(5, n)));
export const replyBody = (text: string) => ({ text: text.trim() });
export const replyProblem = (text: string): string => (!text.trim() ? 'Write a reply first' : text.trim().length > 1000 ? 'Keep the reply under 1000 characters' : '');

export const REVIEW_TEXTS = [
  'Reviews', 'What customers said after their bill', 'Average {avg} out of 5, from {n} ratings shown.', 'No feedback yet. It appears here once a customer rates their bill.',
  'A customer', 'No comment left.', 'Replied', 'Write a reply, or let Flow AI draft one', 'Draft with Flow AI', 'Drafting…', 'Send reply', 'Sending…', 'Reply sent',
  'Write a reply first', 'Keep the reply under 1000 characters', 'Only the owner and admins can see this page.', 'All'
];
