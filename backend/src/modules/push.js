/*
 * Push notifications to the FlowXP phone app, through Expo's push service (it passes them to Google's Firebase Cloud Messaging on Android).
 *
 *   registerDevice / removeDevice   the app tells us a phone's token after sign-in, and when someone signs out or switches notifications off
 *   pushToUsers                     queue a push for some people (a job, so a slow or failing push service never slows an order or a bill)
 *
 * The queued job looks the tokens up when it runs, so a token removed in between is not used. Expo answers each message with a ticket; one that says the phone is no
 * longer registered (app uninstalled) deletes that token. Anything else that fails makes the job retry later (modules/jobs.js).
 *
 * Needs, for real phones: the Firebase key uploaded to the Expo project (`eas credentials`), and optionally EXPO_ACCESS_TOKEN if the Expo project has push security on.
 */
import pool from '../config/database.js';
import config from '../config/env.js';
import { enqueue, registerHandler } from './jobs.js';

const TOKEN = /^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]{10,}\]$/;
export const MAX_DEVICES_PER_PERSON = 8;

export const validToken = (token) => TOKEN.test(String(token || ''));

export const registerDevice = async (userId, token, platform = 'android') => {
  if (!validToken(token)) return { ok: false, message: 'That is not a notification address from the app' };
  const os = ['android', 'ios'].includes(platform) ? platform : 'android';
  await pool.query(
    `INSERT INTO push_devices (user_id, token, platform) VALUES ($1,$2,$3)
     ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, last_seen_at = CURRENT_TIMESTAMP`,
    [userId, token, os]
  );
  // a person keeps only their newest phones; a lost phone's token would otherwise receive their notifications for ever
  await pool.query(
    `DELETE FROM push_devices WHERE user_id = $1 AND device_id NOT IN (SELECT device_id FROM push_devices WHERE user_id = $1 ORDER BY last_seen_at DESC, device_id DESC LIMIT $2)`,
    [userId, MAX_DEVICES_PER_PERSON]
  );
  return { ok: true };
};

/** Only the person it belongs to can remove a token. */
export const removeDevice = async (userId, token) =>
  (await pool.query(`DELETE FROM push_devices WHERE user_id = $1 AND token = $2`, [userId, String(token || '')])).rowCount;

/**
 * What goes to the phone. `data.route` is a screen the app opens when the notification is tapped (the app only follows routes it knows).
 * Android channels: "alerts" rings and pops up (orders, kitchen); "default" is the quiet one.
 */
export const buildMessage = (token, { title, body, data = {}, urgent = false }) => ({
  to: token,
  title: String(title).slice(0, 100),
  body: body ? String(body).slice(0, 240) : undefined,
  data,
  sound: 'default',
  priority: urgent ? 'high' : 'default',
  channelId: urgent ? 'alerts' : 'default',
  ttl: urgent ? 600 : 6 * 3600   // an order alert that arrives half an hour late is worse than none
});

/** Send to Expo in batches of 100. Returns the tokens Expo says are dead. Throws if the service itself could not be reached or refused. */
export const sendMessages = async (messages, { fetchImpl = fetch } = {}) => {
  const dead = [];
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    const response = await fetchImpl(config.push.url, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', ...(config.push.accessToken ? { authorization: `Bearer ${config.push.accessToken}` } : {}) },
      body: JSON.stringify(batch)
    });
    if (!response.ok) throw new Error(`The push service answered ${response.status}`);
    const tickets = (await response.json())?.data;
    if (!Array.isArray(tickets)) throw new Error('The push service sent an answer we could not read');
    tickets.forEach((t, k) => { if (t?.status === 'error' && t.details?.error === 'DeviceNotRegistered') dead.push(batch[k].to); });
  }
  return dead;
};

registerHandler('push', async ({ userIds, title, body, data, urgent }) => {
  if (!config.push.enabled) return;   // switched off (development): nothing to send, and not an error
  const { rows } = await pool.query(`SELECT token FROM push_devices WHERE user_id = ANY($1::int[])`, [userIds]);
  if (!rows.length) return;
  const dead = await sendMessages(rows.map((r) => buildMessage(r.token, { title, body, data, urgent })));
  if (dead.length) await pool.query(`DELETE FROM push_devices WHERE token = ANY($1::text[])`, [dead]);
});

/** Queue a push for these people. Never throws and never waits for the phone: a push problem must not fail an order. */
export const pushToUsers = async (userIds, message, db = pool) => {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length || !config.push.enabled) return 0;
  try {
    await enqueue('push', { userIds: ids, ...message }, { db });
    return ids.length;
  } catch (error) {
    console.error('[push] could not queue:', error.message);
    return 0;
  }
};
