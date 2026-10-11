/*
 * A person's own notifications and delivery preferences. Every query is scoped
 * to the signed-in user inside the current business — no endpoint here can
 * read anyone else's.
 */
import { registerDevice, removeDevice } from '../modules/push.js';
import { list, markAllRead, markRead, preferencesFor, savePreferences, unreadCount } from '../modules/notifications.js';

/* GET /api/notifications?unread=true&limit=30&before=<id> */
export const index = async (req, res) => {
  const { businessId } = req.tenant;
  const items = await list(businessId, req.auth.userId, {
    unreadOnly: req.query.unread === 'true', limit: Number(req.query.limit) || 30, before: Number(req.query.before) || null
  });
  res.json({ success: true, data: { unread: await unreadCount(businessId, req.auth.userId), items } });
};

/* GET /api/notifications/count — cheap enough to poll */
export const count = async (req, res) => {
  res.json({ success: true, data: { unread: await unreadCount(req.tenant.businessId, req.auth.userId) } });
};

/* POST /api/notifications/:id/read */
export const read = async (req, res) => {
  const updated = await markRead(req.tenant.businessId, req.auth.userId, req.params.id);
  if (!updated) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true });
};

/* POST /api/notifications/read-all */
export const readAll = async (req, res) => {
  res.json({ success: true, data: { marked: await markAllRead(req.tenant.businessId, req.auth.userId) } });
};

/* GET /api/notifications/preferences */
export const getPreferences = async (req, res) => {
  res.json({ success: true, data: await preferencesFor(req.tenant, req.auth.userId) });
};

/* PUT /api/notifications/preferences  [{ category, in_app, email }] */
export const putPreferences = async (req, res) => {
  const choices = Array.isArray(req.body) ? req.body : req.body?.preferences;
  if (!Array.isArray(choices)) return res.status(400).json({ success: false, message: 'Send a list of preferences' });
  await savePreferences(req.tenant, req.auth.userId, choices);
  res.json({ success: true, data: await preferencesFor(req.tenant, req.auth.userId) });
};

/* POST /api/notifications/devices { token, platform } — the phone app says where to send this person's notifications */
export const addDevice = async (req, res) => {
  const out = await registerDevice(req.auth.userId, req.body?.token, req.body?.platform);
  if (!out.ok) return res.status(400).json({ success: false, message: out.message });
  res.status(201).json({ success: true });
};

/* DELETE /api/notifications/devices { token } — on sign-out, or when the person switches phone notifications off */
export const dropDevice = async (req, res) => {
  await removeDevice(req.auth.userId, req.body?.token);
  res.json({ success: true });
};
