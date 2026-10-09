/*
 * A manager's PIN when the server asks for one. A cashier or waiter cannot cancel a bill, or give a discount above the business's limit, on their own: the
 * server answers APPROVAL_REQUIRED and this asks for a manager's PIN, then runs the same action again with it (backend modules/approvals.js).
 *
 *   await withApproval(dialog, (approval) => api('/invoices', { method: 'POST', idempotencyKey: idem.get(), body: { ...body, ...(approval ? { approval } : {}) } }), idem.settle);
 *
 * `refused` is told about each refusal so the caller can start a new Idempotency-Key: the server remembers the refused attempt under the old one.
 * Cancelling the box gives the original refusal back, so the till shows why nothing happened.
 */
import { ApiError } from './api.js';

const WRONG = 'APPROVAL_WRONG';

export const withApproval = async (dialog, run, refused = () => {}) => {
  try { return await run(undefined); } catch (first) {
    if (!(first instanceof ApiError) || first.code !== 'APPROVAL_REQUIRED') throw first;
    refused(first);
    let message = first.message;
    for (let tries = 0; tries < 5; tries++) {
      const pin = await dialog.prompt({
        title: 'Manager approval', body: message, label: "Manager's PIN", type: 'password', inputMode: 'numeric', autoComplete: 'off', confirmLabel: 'Approve', required: true
      });
      if (pin == null) throw first;
      try { return await run({ pin }); } catch (error) {
        if (error instanceof ApiError && error.code === WRONG) { refused(error); message = error.message; continue; }
        throw error;
      }
    }
    throw first;
  }
};
