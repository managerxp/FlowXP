/* The hotel manager's side on a phone: closing the day (night audit), the day's figures, banquet events and their money, and the staff for the day.
   The server does every sum and rule; these are the shapes and the small checks the screens need. All money from the server is in paise. */

export type AuditPreview = {
  business_date: string; next_date: string; rooms_in_house: number;
  pending_arrivals: { booking_id: number; res_no: string; arrival: string; guest_name: string; rooms: number }[];
  overdue_departures: { booking_id: number; res_no: string; guest_name: string; rooms: string }[];
  last_audit: { audit_date: string; run_at: string } | null;
};
export type Figures = {
  rooms_available: number; rooms_sold: number; occupancy_pct: number; adr_paise: number; revpar_paise: number; room_revenue_paise: number; fnb_revenue_paise: number; other_revenue_paise: number;
  total_revenue_paise: number; arrivals: number; departures: number; in_house_guests: number; no_shows: number; cancellations: number;
};
export type Flash = { date: string; business_date: string; provisional: boolean; day: Figures | null; month_to_date: Figures; year_to_date: Figures; now: { rooms_in_house: number; arrivals_expected: number; departures_expected: number; rooms_out_of_order: number; rooms_dirty: number } };
export type Collections = { from: string; to: string; methods: { method: string; hotel_paise: number; banquet_paise: number; restaurant_paise: number; refunds_paise: number; net_paise: number }[]; total_paise: number };
export type HighBalance = { booking_id: number; res_no: string; guest_name: string; rooms: string | null; balance_paise: number };

export type BanquetEvent = {
  event_id: number; event_no: string; status: 'ENQUIRY' | 'TENTATIVE' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED'; title: string; event_type: string | null; organiser: string; phone: string | null;
  first_date: string | null; functions: number; guests: number; charges_paise: number; paid_paise: number;
};
export type BanquetDetail = BanquetEvent & {
  functions: { function_id: number; event_date: string; start_time: string; end_time: string; hall_name: string; package_name: string | null; expected_guests: number; guaranteed_guests: number | null }[];
  payments: { bp_id: number; kind: string; method: string; amount_paise: number; pay_date: string }[];
  totals: { charges_paise: number; paid_paise: number; balance_paise: number };
};
export type Headcount = { date: string; total: number; present: number; absent: number; on_leave: number; unmarked: number; pending_leaves: number };
export type StaffDay = { employee_id: number; emp_code: string; name: string; designation: string | null; department: string | null; status: string | null; leave_kind: string | null; weekly_off_today: boolean };
export type Leave = { leave_id: number; employee: string; from_date: string; to_date: string; kind: string; reason: string | null; status: string };

export const EVENT_TEXT: Record<BanquetEvent['status'], string> = { ENQUIRY: 'Enquiry', TENTATIVE: 'Held', CONFIRMED: 'Confirmed', COMPLETED: 'Done and billed', CANCELLED: 'Cancelled' };
export const ATT_CHOICES: { id: string; label: string }[] = [{ id: 'PRESENT', label: 'Present' }, { id: 'HALF_DAY', label: 'Half day' }, { id: 'ABSENT', label: 'Absent' }];
export const ATT_TEXT: Record<string, string> = { PRESENT: 'Present', HALF_DAY: 'Half day', ABSENT: 'Absent', LEAVE: 'On leave', UNPAID_LEAVE: 'On leave (unpaid)', WEEKLY_OFF: 'Day off', HOLIDAY: 'Holiday' };
export const BANQUET_METHODS: { id: string; label: string }[] = [{ id: 'CASH', label: 'Cash' }, { id: 'UPI', label: 'UPI' }, { id: 'CARD', label: 'Card' }, { id: 'BANK_TRANSFER', label: 'Bank transfer' }, { id: 'CHEQUE', label: 'Cheque' }];

export const rs = (paise: number | string | null | undefined): string => `₹${Math.round(Number(paise || 0) / 100).toLocaleString('en-IN')}`;

/** Closing the day: bookings that have not arrived must be settled first. `noShowAll` marks them all as no-shows in one go. */
export const auditBody = (noShowAll: boolean) => (noShowAll ? { no_show_all: true } : {});
export const auditBlocked = (p: Pick<AuditPreview, 'pending_arrivals'>): boolean => p.pending_arrivals.length > 0;

export const bankPaymentProblem = (amount: number, balancePaise: number, kind: 'ADVANCE' | 'PAYMENT'): string =>
  !(amount > 0) ? 'Type the amount.' : kind === 'PAYMENT' && Math.round(amount * 100) > balancePaise && balancePaise >= 0 ? 'That is more than is still to pay.' : '';
export const bankPaymentBody = (amount: number, method: string, kind: 'ADVANCE' | 'PAYMENT') => ({ kind, method, amount });
/** The first payment on an event is an advance; later ones settle the bill. */
export const paymentKind = (d: Pick<BanquetDetail, 'payments'>): 'ADVANCE' | 'PAYMENT' => (d.payments.length === 0 ? 'ADVANCE' : 'PAYMENT');

export const attendanceBody = (date: string, employeeId: number, status: string) => ({ date, entries: [{ employee_id: employeeId, status }] });
export const leaveBody = (action: 'APPROVE' | 'REJECT') => ({ action });
export const leaveDays = (l: Pick<Leave, 'from_date' | 'to_date'>): number => Math.round((Date.parse(`${l.to_date}T00:00:00Z`) - Date.parse(`${l.from_date}T00:00:00Z`)) / 86400000) + 1;
