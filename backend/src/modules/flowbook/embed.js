/*
 * FlowBook inside the FlowXP app: one server, one sign-in, one database, one website.
 *
 * FlowBook's code (flowbook/api, Fastify + TypeScript) is loaded here and answers every request under /api/books (so /api/books/v1/...
 * is FlowBook's /v1/...). It sits behind FlowXP's own sign-in and business choice, like every other part of the app: the person who is
 * signed in to FlowXP is the person in the books, and their FlowXP business is the books they work in. There is no second login, no
 * handoff and no secret to share. It uses FlowXP's database, in its own schema named `flowbook`, and FlowXP's mailbox and WhatsApp number.
 * It is mounted before the body parsers, because FlowBook reads the request body itself.
 *
 * If FlowBook cannot start (its folder is missing, or Node is older than 24 and cannot read the TypeScript) the FlowXP API still runs and
 * /api/books answers 503. FLOWBOOK_EMBEDDED=false turns it off.
 */
import { createHash } from 'node:crypto';
import config from '../../config/env.js';
import { complete, isConfigured } from '../ai/provider.js';
import { deliverMail, mailConfigured } from '../mailer.js';
import { platformWhatsapp } from '../messaging/provider.js';
import { CHECK_NOTE, ungrounded } from '../ai/grounding.js';
import { hasPlanFeature } from '../planFeatures.js';
import { openLink, setLocalDelivery } from './outbox.js';
import { featuresOff, gate, record } from './gate.js';

const unavailable = (res, status, message) => res.status(status).json({ success: false, message });

export const embeddedFlowbook = () => {
  let booted = null;
  let failed = null;
  const linked = new Set();   // businesses whose sales feed has been made, this run

  /** Start it: run after FlowXP's own migrations, so the database is ready. Never throws. */
  const start = async () => {
    if (process.env.FLOWBOOK_EMBEDDED === 'false') { failed = new Error('switched off'); return; }
    try {
      if (Number(process.versions.node.split('.')[0]) < 24) throw new Error(`FlowBook needs Node 24 or newer, this server runs Node ${process.versions.node}. Upgrade Node, then restart.`);
      // the key FlowBook seals stored tokens with comes from FlowXP's own, so nothing extra is set
      process.env.FLOWBOOK_SECRET_KEY ||= createHash('sha256').update(`flowbook-keys:${config.encryptionKey || config.jwtSecret}`).digest('base64');
      const { bootFlowbook } = await import('../../../../flowbook/api/src/boot.ts');
      booted = await bootFlowbook(config.databaseUrl, [], {
        shared: true,
        ai: { configured: isConfigured, complete, ungrounded, checkNote: CHECK_NOTE, gate, record },
        featuresOff,
        mail: { configured: mailConfigured, send: (m) => deliverMail({ to: m.to, subject: m.subject, text: m.text, html: m.html, replyTo: m.replyTo, bcc: m.bcc, fromName: m.from }) },
        whatsapp: platformWhatsapp
      });
      setLocalDelivery((businessId, event) => booted.ingest(businessId, event));
      console.log('[flowbook] running inside the FlowXP API at /api/books');
    } catch (error) {
      failed = error;
      console.error('[flowbook] could not start inside the FlowXP API:', error.message);
    }
  };

  /** After FlowXP's requireAuth and withBusiness: who this is and which business, handed to FlowBook on the request itself. */
  const middleware = async (req, res, next) => {
    if (!booted && failed?.message === 'switched off') return next();
    if (!booted) return unavailable(res, 503, 'FlowBook is not available right now');
    const t = req.tenant;
    if (!hasPlanFeature(t, 'flowbook_app')) return unavailable(res, 402, 'FlowBook is not part of this business plan. Contact us to turn it on.');
    // FlowBook is the offer of a business that signed up for it; any other business has it once it is paying and its plan includes it
    const own = t.businessType === 'FLOWBOOK';
    if (!own && !(t.subscription.status === 'ACTIVE' && hasPlanFeature(t, 'flowbook'))) return unavailable(res, 402, 'FlowBook is not part of this business plan. Contact us to turn it on.');
    try {
      // a business that has a till sends its sales to the books from the day it opens them
      if (!own && !linked.has(t.businessId)) { await openLink(t.businessId); linked.add(t.businessId); }
      const s = t.subscription;
      req.flowxp = { sub: String(t.userId), email: req.auth.email, name: req.auth.user.name, bid: String(t.businessId), bname: t.name, role: t.role, status: s.status, tend: s.trial_ends_at ? new Date(s.trial_ends_at).toISOString() : null };
    } catch (error) {
      console.error('[flowbook] could not prepare the request:', error.message);
      return unavailable(res, 500, 'Something went wrong');
    }
    res.set('Cache-Control', 'no-store');
    return booted.app.routing(req, res);
  };

  return { start, middleware, close: async () => { await booted?.close(); } };
};
