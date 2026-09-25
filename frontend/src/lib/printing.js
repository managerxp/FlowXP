/*
 * Per-device printing and alert preferences (this till, this kitchen screen),
 * kept in the browser: two devices in one restaurant want different settings
 * (the pass prints KOTs and beeps, the front counter prints receipts), so these
 * are not business-wide. Paper size, footer and the optional receipt blocks ARE
 * business-wide and live on the server (Business settings).
 */
const KEY = 'flowxp.device';
const DEFAULTS = { autoPrintKot: false, autoPrintReceipt: false, kitchenSound: true };

export const getDevicePrefs = () => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
};

export const setDevicePref = (key, value) => {
  try { localStorage.setItem(KEY, JSON.stringify({ ...getDevicePrefs(), [key]: value })); } catch { /* private mode: the choice just isn't remembered */ }
};

/** Open the print view of a receipt or KOT in a new tab; it prints itself when it has loaded. */
export const openPrint = (kind, id, extra = '') => window.open(`/app/print/${kind}/${id}?auto=1${extra}`, '_blank');

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
