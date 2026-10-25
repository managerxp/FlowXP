/*
 * Workshop job cards (modules/autoparts/jobcards.js). Permissions and the plan feature are decided in the router (autoparts.routes.js).
 */
import pool from '../config/database.js';
import { audit, inTx, int, isoDate, like, ok, paging, wrapAll } from '../modules/autoparts/common.js';
import * as jobs from '../modules/autoparts/jobcards.js';
import { sendJobUpdate } from '../modules/autoparts/jobMessages.js';
import { recordInvoiceCreated } from '../modules/billing.js';

const id = (req, label = 'Id') => int(req.params.id, label, { min: 1, required: true });
const uid = (req) => req.auth?.userId ?? req.tenant?.userId ?? null;
const SKIP_WORDS = { PLAN: 'WhatsApp messages are not part of this plan.', NO_PHONE: 'This customer has no mobile number.', NO_ESTIMATE: 'Add the parts or labour first, so there is an estimate to send.', OFF: 'Messaging is switched off. Choose WhatsApp or SMS under Messaging.', UNKNOWN_EVENT: 'Choose received, estimate or ready.' };

export default wrapAll({
  list: async (req, res) => ok(res, await jobs.listJobs(pool, req.tenant, { status: req.query.status, q: req.query.q ? String(req.query.q).trim().slice(0, 60) : null, reg: req.query.reg, customerId: req.query.customer_id, mechanicId: req.query.mechanic_id, ...paging(req.query, { max: 200, fallback: 50 }), like })),
  due: async (req, res) => ok(res, await jobs.dueServices(pool, req.tenant, { days: Math.min(90, Math.max(0, Number(req.query.days) || 14)) })),
  mechanics: async (req, res) => ok(res, await jobs.mechanics(pool, req.tenant)),
  share: async (req, res) => ok(res, await jobs.shareJob(pool, req.tenant, id(req), req.query.event)),
  // the counter presses "Send on WhatsApp": the same update, from the shop's own messaging channel (the plan still decides)
  sendUpdate: async (req, res) => {
    const r = await sendJobUpdate(req.tenant, id(req), String(req.body?.event || ''), { manual: true, createdBy: uid(req) });
    if (r.skipped) return res.status(409).json({ success: false, message: SKIP_WORDS[r.skipped] || 'Could not send that message', code: r.skipped });
    ok(res, { status: r.status, error: r.error ?? null });
  },
  services: async (req, res) => ok(res, await jobs.listServices(pool, req.tenant)),
  saveService: async (req, res) => ok(res, await inTx((db) => jobs.saveService(db, req.tenant, req.body || {})), 201),
  removeService: async (req, res) => ok(res, await inTx((db) => jobs.removeService(db, req.tenant, id(req)))),
  report: async (req, res) => {
    const now = new Date(); const iso = (d) => d.toISOString().slice(0, 10);
    const from = req.query.from ? isoDate(req.query.from, 'From') : iso(new Date(now.getFullYear(), now.getMonth(), 1));
    const to = req.query.to ? isoDate(req.query.to, 'To') : iso(now);
    ok(res, await jobs.workshopReport(pool, req.tenant, { from, to }));
  },
  get: async (req, res) => ok(res, await jobs.getJob(pool, req.tenant, id(req))),
  create: async (req, res) => {
    const j = await inTx((db) => jobs.createJob(db, req.tenant, uid(req), req.body || {}));
    audit(req, 'autoparts.job_opened', 'job_card', j.job_id, null, { job_no: j.job_no, vehicle_reg: j.vehicle_reg });
    ok(res, j, 201);
    sendJobUpdate(req.tenant, j.job_id, 'received', { createdBy: uid(req) });   // after the answer: the counter never waits for WhatsApp
  },
  update: async (req, res) => ok(res, await inTx((db) => jobs.updateJob(db, req.tenant, id(req), req.body || {}))),
  status: async (req, res) => {
    const j = await inTx((db) => jobs.setStatus(db, req.tenant, id(req), req.body?.status));
    audit(req, 'autoparts.job_status', 'job_card', j.job_id, null, { status: j.status });
    ok(res, j);
    if (j.status === 'READY') sendJobUpdate(req.tenant, j.job_id, 'ready', { createdBy: uid(req) });
  },
  lineAdd: async (req, res) => ok(res, (await inTx((db) => jobs.addLine(db, req.tenant, uid(req), id(req), req.body || {}))).job, 201),
  lineUpdate: async (req, res) => ok(res, await inTx((db) => jobs.updateLine(db, req.tenant, uid(req), id(req), req.body || {}))),
  lineRemove: async (req, res) => ok(res, await inTx((db) => jobs.removeLine(db, req.tenant, id(req)))),
  bill: async (req, res) => {
    const r = await inTx((db) => jobs.billJob(db, req.tenant, uid(req), id(req), { ...(req.body || {}), clientKey: req.headers['idempotency-key'] || undefined }));
    recordInvoiceCreated(req, r.invoice);
    audit(req, 'autoparts.job_billed', 'job_card', r.job.job_id, null, { job_no: r.job.job_no, invoice_id: r.invoice.invoice_id });
    ok(res, { job: r.job, invoice: r.invoice }, 201);
  }
});
