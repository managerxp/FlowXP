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
  // Billing at a restaurant or café: send each counter sale to the kitchen as well
  posSendToKitchen: true,
  // A loud repeating ring for an incoming Zomato/Swiggy/ONDC/Magicpin order waiting to be accepted
  deliveryRingSound: true,
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

/* Where a job goes: the printer the server routed it to (Settings > Printers), else this device's own address for that job, as before.
   'browser' (a printer set to use the print dialog) and no address at all both mean "use the browser print view". */
const targetFor = (routed, own) => { const t = routed || own || ''; return t === 'browser' ? '' : t; };

/** Print a receipt: silently when the agent is set up, else the browser print view. `cash` pops the drawer with it. */
export const printReceipt = async (invoiceId, { cash = false, upi = null } = {}) => {
  const prefs = getDevicePrefs();
  const extra = upi ? `&upi=${upi}` : '';   // `upi` (rupees): the bill carries a QR for exactly that amount
  if (!agentOn(prefs)) return openPrint('receipt', invoiceId, extra);
  try {
    const d = cash && prefs.openDrawer ? '?drawer=1' : '';
    const job = await api(`/invoices/${invoiceId}/escpos${d}${upi ? `${d ? '&' : '?'}upi=${upi}` : ''}`);
    const target = targetFor(job.target, prefs.receiptTarget);
    if (!target) return openPrint('receipt', invoiceId, extra);
    await sendToAgent(target, job.data, prefs);
  } catch (error) { onPrintError(`Receipt not printed: ${error.message}`); openPrint('receipt', invoiceId, extra); }
  return null;
};

/** Is silent printing set up on this computer? Then a UPI bill can print by itself the moment it is saved (a browser print tab needs a click). */
export const silentPrinting = () => agentOn(getDevicePrefs());

/** Print a kitchen ticket, one slip per station, each to the printer its station is routed to. */
export const printKot = async (kotId) => {
  const prefs = getDevicePrefs();
  if (!agentOn(prefs)) return openPrint('kot', kotId);
  try {
    const { slips } = await api(`/kitchen/kots/${kotId}/escpos`);
    let browserNeeded = false;
    for (const slip of slips) {
      const target = targetFor(slip.target, prefs.kotTarget || prefs.receiptTarget);
      if (target) await sendToAgent(target, slip.data, prefs); else browserNeeded = true;
    }
    if (browserNeeded) openPrint('kot', kotId);   // a station set to the print dialog (or with no printer at all) uses the browser view
  } catch (error) { onPrintError(`Kitchen ticket not printed: ${error.message}`); openPrint('kot', kotId); }
  return null;
};

/** Open the cash drawer on its own (a cash payment taken without a receipt). */
export const openDrawer = async () => {
  const prefs = getDevicePrefs();
  if (!agentOn(prefs)) return;
  try {
    const job = await api('/print/drawer');
    const target = targetFor(job.target, prefs.receiptTarget);
    if (target) await sendToAgent(target, job.data, prefs);
  } catch (error) { onPrintError(`Cash drawer not opened: ${error.message}`); }
};

/** For the settings screen: send a test page (or open the drawer) with the given (unsaved) agent settings. `printerId` tests that printer from the Printers list. */
export const testPrint = async (prefs, { drawer = false, printerId = null } = {}) => {
  await agentStatus(prefs);                                  // is it there, and is the token right?
  const job = await api(`/print/test?${new URLSearchParams({ ...(drawer ? { drawer: '1' } : {}), ...(printerId ? { printer: printerId } : {}) })}`);
  const target = targetFor(job.target, prefs.receiptTarget);
  if (!target) throw new Error(printerId ? 'That printer uses the browser print dialog, so there is nothing to test here.' : 'No receipt printer is set up yet.');
  await sendToAgent(target, job.data, prefs);
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

/* A loud, unmissable ring for a delivery-platform order waiting to be accepted or rejected —
   deliberately louder and longer than beep(), which is easy to miss under kitchen noise. The
   caller (IncomingDeliveryAlert.jsx) repeats this every few seconds until the order is handled. */
export const ringAlarm = () => {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    // two short "ring ring" bursts, each two rising tones, louder than beep()
    const pattern = [[520, 0], [660, 0.14], [520, 0.5], [660, 0.64]];
    for (const [freq, at] of pattern) {
      const osc = audio.createOscillator(); const gain = audio.createGain();
      osc.frequency.value = freq; osc.type = 'triangle';
      gain.gain.setValueAtTime(0.0001, audio.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.55, audio.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + at + 0.13);
      osc.connect(gain).connect(audio.destination);
      osc.start(audio.currentTime + at); osc.stop(audio.currentTime + at + 0.15);
    }
  } catch { /* no audio available: the banner still shows */ }
};
