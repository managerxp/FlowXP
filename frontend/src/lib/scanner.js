/*
 * Camera barcode scanning that runs on the device: nothing is photographed and uploaded.
 *
 * Where the browser has the built-in BarcodeDetector (Chrome on Android, the phones most counters use) that does the
 * work: it is native, fast and good with poor light. Everywhere else a small bundled decoder (@zxing, loaded only when
 * the camera is first opened) reads the same video, tuned to try harder on damaged or small codes.
 *
 * startScanner() returns { stop, kind, track }; the caller decides what a code means and runs it through
 * lib/scanGate.js so one item held in view counts once.
 */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];

export const hasNativeDetector = () => typeof window !== 'undefined' && 'BarcodeDetector' in window;
export const cameraAvailable = () => typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

/** Why the camera could not start, in terms the screen can explain. */
export const cameraProblem = (error) => {
  if (!cameraAvailable()) return 'none';
  const name = error?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'none';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  return 'error';
};

export const startScanner = async ({ video, onCode }) => {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
  });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play();

  let stopped = false; let controls = null;
  const track = stream.getVideoTracks()[0];
  const stop = () => {
    stopped = true;
    try { controls?.stop?.(); } catch { /* already stopped */ }
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };

  try {
    if (hasNativeDetector()) {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const detector = new window.BarcodeDetector({ formats: FORMATS.filter((f) => supported.includes(f)) });
      (async () => {
        while (!stopped) {
          try { for (const b of await detector.detect(video)) onCode(b.rawValue); } catch { /* a frame that could not be read */ }
          await new Promise((resolve) => setTimeout(resolve, 70));
        }
      })();
      return { stop, track, kind: 'native' };
    }
    // the decoder's own frame loop is not used: we read the video ourselves (a canvas, a luminance array, the
    // multi-format reader), which is all it needs and keeps this small and predictable on a low-end phone
    const { BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } = await import('@zxing/library');
    const reader = new MultiFormatReader();
    reader.setHints(new Map([
      [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF]],
      [DecodeHintType.TRY_HARDER, true]
    ]));
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let timer = null;
    const tick = () => {
      if (stopped) return;
      try {
        const vw = video.videoWidth;
        if (vw) {
          const scale = Math.min(1, 960 / vw);
          canvas.width = Math.round(vw * scale); canvas.height = Math.round(video.videoHeight * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const luminance = new Uint8ClampedArray(canvas.width * canvas.height);
          for (let i = 0, j = 0; i < data.length; i += 4, j += 1) luminance[j] = (data[i] * 306 + data[i + 1] * 601 + data[i + 2] * 117) >> 10;
          const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminance, canvas.width, canvas.height)));
          onCode(reader.decodeWithState(bitmap).getText());
        }
      } catch { /* nothing readable in this frame */ }
      timer = setTimeout(tick, 70);
    };
    controls = { stop: () => clearTimeout(timer) };
    tick();
    return { stop, track, kind: 'zxing' };
  } catch (error) { stop(); throw error; }
};

/** The torch, where the camera has one: the fix for a dim aisle. Resolves to whether it is now on. */
export const torchSupported = (track) => Boolean(track?.getCapabilities?.().torch);
export const setTorch = async (track, on) => { await track.applyConstraints({ advanced: [{ torch: on }] }); return on; };

/* Feedback the shopper can feel and hear without looking at the screen. */
let audio = null;
export const vibrate = (pattern) => { try { navigator.vibrate?.(pattern); } catch { /* not supported */ } };
export const beep = (ok = true) => {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audio.createOscillator(); const gain = audio.createGain();
    osc.frequency.value = ok ? 1040 : 330; osc.type = 'sine';
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + (ok ? 0.09 : 0.22));
    osc.connect(gain); gain.connect(audio.destination); osc.start(); osc.stop(audio.currentTime + (ok ? 0.1 : 0.24));
  } catch { /* no audio */ }
};
export const SOUND_KEY = 'flowxp.scanSound';
export const soundOn = () => { try { return localStorage.getItem(SOUND_KEY) !== '0'; } catch { return true; } };
export const setSound = (on) => { try { localStorage.setItem(SOUND_KEY, on ? '1' : '0'); } catch { /* private mode */ } };
