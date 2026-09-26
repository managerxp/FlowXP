/*
 * Per-device printing and alert preferences (this till, this kitchen screen),
 * kept in the browser: two devices in one restaurant want different settings
 * (the pass prints KOTs and beeps, the front counter prints receipts), so these
 * are not business-wide. Paper size, footer and the optional receipt blocks ARE
 * business-wide and live on the server (Business settings).
 */
import { api } from './api.js';

const KEY = 'flowxp.device';
const DEFAULTS = {
  autoPrintKot: false, autoPrintReceipt: false, kitchenSound: true,
  // Silent printing through the print agent on this computer (see print-agent/README.md)
  printMode: 'browser', agentUrl: 'http://127.0.0.1:9101', agentToken: '', receiptTarget: '', kotTarget: '', openDrawer: false
};

export const getDevicePrefs = () => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
};

export const setDevicePref = (key, value) => {
  try { localStorage.setItem(KEY, JSON.stringify({ ...getDevicePrefs(), [key]: value })); } catch { /* private mode: the choice just isn't remembered */ }
};

/** Open the print view of a receipt or KOT in a new tab; it prints itself when it has loaded. */
export const openPrint = (kind, id, extra = '') => window.open(`/app/print/${kind}/${id}?auto=1${extra}`, '_blank');

/* ── Silent printing through the print agent ─────────────────────────────
   The agent runs on the till computer and passes ESC/POS bytes from the server to the printer, so there is
   no print dialog, and the same job can open the cash drawer. When it is off or fails, the browser print view
   is used instead, so a receipt is never lost to a broken cable. */

let onPrintError = () => {};
/** The app shell registers a toast here so print problems are seen, not just logged. */
export const setPrintErrorHandler = (fn) => { onPrintError = fn || (() => {}); };

const agentOn = (p = getDevicePrefs()) => p.printMode === 'agent' && Boolean(p.agentToken);

const agent = async (path, { method = 'GET', body, prefs = getDevicePrefs() } = {}) => {
  let response;
  try {
    response = await fetch(`${prefs.agentUrl.replace(/\/$/, '')}${path}`, {
      method, headers: { authorization: `Bearer ${prefs.agentToken}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new Error('Cannot reach the print agent on this computer. Is it running?');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The print agent refused the job');
  return data;
};

export const agentStatus = (prefs) => agent('/status', { prefs });
const sendToAgent = (target, data, prefs) => agent('/print', { method: 'POST', body: { target, data }, prefs });

/** Fetch the printer bytes for a receipt/KOT/test page and send them. Throws on any problem. */
const printJob = async (kind, id, { drawer = false, prefs = getDevicePrefs() } = {}) => {
  const d = drawer ? '?drawer=1' : '';
  if (kind === 'receipt') return sendToAgent(prefs.receiptTarget, (await api(`/invoices/${id}/escpos${d}`)).data, prefs);
  if (kind === 'test') return sendToAgent(prefs.receiptTarget, (await api(`/print/test${d}`)).data, prefs);
  const { slips } = await api(`/kitchen/kots/${id}/escpos`);
  for (const slip of slips) await sendToAgent(prefs.kotTarget || prefs.receiptTarget, slip.data, prefs);
};

/** Print a receipt: silently when the agent is set up, else the browser print view. `cash` pops the drawer with it. */
export const printReceipt = async (invoiceId, { cash = false } = {}) => {
  const prefs = getDevicePrefs();
  if (!agentOn(prefs) || !prefs.receiptTarget) return openPrint('receipt', invoiceId);
  try { await printJob('receipt', invoiceId, { drawer: cash && prefs.openDrawer, prefs }); }
  catch (error) { onPrintError(`Receipt not printed: ${error.message}`); openPrint('receipt', invoiceId); }
  return null;
};

/** Print a kitchen ticket, one slip per station. */
export const printKot = async (kotId) => {
  const prefs = getDevicePrefs();
  if (!agentOn(prefs) || !(prefs.kotTarget || prefs.receiptTarget)) return openPrint('kot', kotId);
  try { await printJob('kot', kotId, { prefs }); }
  catch (error) { onPrintError(`Kitchen ticket not printed: ${error.message}`); openPrint('kot', kotId); }
  return null;
};

/** Open the cash drawer on its own (a cash payment taken without a receipt). */
export const openDrawer = async () => {
  const prefs = getDevicePrefs();
  if (!agentOn(prefs) || !prefs.receiptTarget) return;
  try { await sendToAgent(prefs.receiptTarget, (await api('/print/drawer')).data, prefs); }
  catch (error) { onPrintError(`Cash drawer not opened: ${error.message}`); }
};

/** For the settings screen: run a job with the given (unsaved) settings and report the outcome as text. */
export const testPrint = async (prefs, { drawer = false } = {}) => {
  await agentStatus(prefs);                                  // is it there, and is the token right?
  await printJob('test', null, { drawer, prefs });
};

/* A short beep, made with the browser's own audio: no sound files to ship. The context is created
   on first use, which must follow a click (turning the bell on counts). */
let audio = null;
export const beep = (kind = 'new') => {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const pattern = kind === 'late' ? [[880, 0], [660, 0.22], [880, 0.44]] : [[660, 0], [880, 0.16]];
    for (const [freq, at] of pattern) {
      const osc = audio.createOscillator(); const gain = audio.createGain();
      osc.frequency.value = freq; osc.type = 'sine';
      gain.gain.setValueAtTime(0.0001, audio.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + at + 0.16);
      osc.connect(gain).connect(audio.destination);
      osc.start(audio.currentTime + at); osc.stop(audio.currentTime + at + 0.18);
    }
  } catch { /* no audio available: the screen still shows everything */ }
};
