/*
 * Scan & Add: the phone's camera as a barcode scanner. It stays open while a basket is scanned (one beep and buzz per
 * item, the same item twice adds twice), and only "Done" closes it.
 *
 *   onScan(code) -> { status: 'ok' | 'unknown' | 'blocked' | 'error', label, detail }
 *     ok       the product was added; label is its name, detail its quantity so far
 *     unknown  no product has that barcode: scanning pauses on a panel (Create product / Search / Scan again)
 *     blocked  found but not sellable here; error: the lookup itself failed
 *
 * If the camera cannot start (permission refused, no camera, in use) the screen says so and offers search instead:
 * a till is never stuck behind a camera.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CameraOff, Flashlight, Plus, ScanLine, Search, Volume2, VolumeX, X } from 'lucide-react';
import { createScanGate } from '../lib/scanGate.js';
import { beep, cameraProblem, setSound, setTorch, soundOn, startScanner, torchSupported, vibrate } from '../lib/scanner.js';

const PROBLEMS = {
  denied: ['Camera access is needed for scanning', 'Allow the camera for this site in your browser settings (the lock or camera icon beside the address), then open Scan again. You can keep billing with search in the meantime.'],
  none: ['No camera found on this device', 'Billing works the same without it: search by name, SKU or barcode.'],
  busy: ['The camera is busy', 'Another app is using it. Close that app and try again, or use search.'],
  error: ['The camera could not start', 'Try again, or use search.']
};

const BarcodeScanner = ({ onScan, onClose, onSearch, onCreate, canCreate, skipCode }) => {
  const video = useRef(null);
  const engine = useRef(null);
  const gate = useMemo(() => { const g = createScanGate(); if (skipCode) g.mark(skipCode); return g; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = useRef(false);
  const paused = useRef(false);
  const handler = useRef(onScan);
  handler.current = onScan;

  const [problem, setProblem] = useState(null);
  const [torchOn, setTorchOn] = useState(false);
  const [canTorch, setCanTorch] = useState(false);
  const [sound, setSoundState] = useState(soundOn);
  const [last, setLast] = useState(null);           // { status, label, detail }
  const [unknown, setUnknown] = useState(null);     // the code with no product
  const [added, setAdded] = useState(0);
  const [session, setSession] = useState([]);       // [{ label, count }] for this scanning session
  const soundRef = useRef(sound); soundRef.current = sound;

  const run = async (code) => {
    if (busy.current || paused.current) return;
    busy.current = true;
    let result;
    try { result = await handler.current(code); } catch (error) { result = { status: 'error', label: error.message || 'Could not look that up' }; }
    busy.current = false;
    setLast({ ...result, at: Date.now() });
    if (result.status === 'ok') {
      vibrate(35); if (soundRef.current) beep(true);
      setAdded((n) => n + 1);
      setSession((s) => { const i = s.findIndex((x) => x.label === result.label); if (i < 0) return [{ label: result.label, count: 1 }, ...s]; const next = [...s]; next[i] = { ...next[i], count: next[i].count + 1 }; return next; });
    } else {
      vibrate([60, 40, 60]); if (soundRef.current) beep(false);
      if (result.status === 'unknown') { paused.current = true; setUnknown(code); }
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const started = await startScanner({ video: video.current, onCode: (code) => { if (gate(code)) run(code); } });
        if (cancelled) { started.stop(); return; }
        engine.current = started;
        setCanTorch(torchSupported(started.track));
      } catch (error) { if (!cancelled) setProblem(cameraProblem(error)); }
    })();
    return () => { cancelled = true; engine.current?.stop(); engine.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the confirmation fades on its own; a miss stays until the next scan
  useEffect(() => {
    if (last?.status !== 'ok') return undefined;
    const t = setTimeout(() => setLast((l) => (l === last ? null : l)), 1600);
    return () => clearTimeout(t);
  }, [last]);

  const resume = () => { paused.current = false; setUnknown(null); setLast(null); };
  const toggleTorch = async () => { try { setTorchOn(await setTorch(engine.current.track, !torchOn)); } catch { setCanTorch(false); } };
  const toggleSound = () => { const next = !sound; setSound(next); setSoundState(next); };

  const finish = () => onClose(added);

  return (
    <div role="dialog" aria-modal="true" aria-label="Scan items" className="fixed inset-0 z-[70] flex flex-col bg-black text-white">
      <video ref={video} className={`absolute inset-0 h-full w-full object-cover ${problem ? 'hidden' : ''}`} muted playsInline aria-hidden="true" />

      <div className="relative z-10 flex items-center justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button type="button" onClick={finish} aria-label="Close the scanner" className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 hover:bg-black/70"><X aria-hidden="true" className="h-5 w-5" /></button>
        <p className="rounded-full bg-black/55 px-3 py-1.5 text-small font-medium"><ScanLine aria-hidden="true" className="mr-1.5 inline h-4 w-4" />Scan & Add</p>
        <div className="flex gap-2">
          {canTorch && <button type="button" onClick={toggleTorch} aria-pressed={torchOn} aria-label="Torch" className={`flex h-11 w-11 items-center justify-center rounded-full ${torchOn ? 'bg-amber-400 text-black' : 'bg-black/55 hover:bg-black/70'}`}><Flashlight aria-hidden="true" className="h-5 w-5" /></button>}
          <button type="button" onClick={toggleSound} aria-pressed={sound} aria-label={sound ? 'Sound on' : 'Sound off'} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 hover:bg-black/70">
            {sound ? <Volume2 aria-hidden="true" className="h-5 w-5" /> : <VolumeX aria-hidden="true" className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {problem ? (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <CameraOff aria-hidden="true" className="h-12 w-12 text-white/70" />
          <div><h2 className="text-title font-semibold">{PROBLEMS[problem][0]}</h2><p className="mx-auto mt-2 max-w-sm text-small text-white/75">{PROBLEMS[problem][1]}</p></div>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => onSearch(null)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-white px-5 font-semibold text-ink-900"><Search aria-hidden="true" className="h-4 w-4" />Use search instead</button>
            <button type="button" onClick={() => { setProblem(null); window.location.reload(); }} className="inline-flex min-h-11 items-center rounded-lg border border-white/40 px-5 font-medium">Try again</button>
          </div>
        </div>
      ) : (
        <div className="relative z-10 flex flex-1 items-center justify-center px-8">
          <div className="relative h-40 w-full max-w-sm rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.38)]" aria-hidden="true">
            <span className="absolute inset-x-4 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" />
          </div>
        </div>
      )}

      <div className="relative z-10 space-y-3 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {unknown ? (
          <div role="alert" className="rounded-2xl bg-white p-4 text-ink-900">
            <p className="text-body font-semibold">Product not found</p>
            <p className="tabular mt-0.5 text-small text-ink-500">{unknown}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {canCreate
                ? <button type="button" onClick={() => onCreate(unknown)} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 font-semibold text-white"><Plus aria-hidden="true" className="h-4 w-4" />Create product</button>
                : <p className="text-caption text-ink-500 sm:col-span-1">Ask a manager to add it.</p>}
              <button type="button" onClick={() => onSearch(unknown)} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-line-strong px-3 font-medium"><Search aria-hidden="true" className="h-4 w-4" />Search product</button>
              <button type="button" onClick={resume} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line-strong px-3 font-medium">Scan again</button>
            </div>
          </div>
        ) : last && (
          <div role="status" className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${last.status === 'ok' ? 'bg-emerald-500 text-white' : 'bg-red-600 text-white'}`}>
            {last.status === 'ok' && <Check aria-hidden="true" className="h-5 w-5 shrink-0" />}
            <p className="min-w-0 flex-1 truncate text-body font-semibold">{last.status === 'ok' ? `${last.label} added` : last.label}</p>
            {last.detail && <p className="tabular shrink-0 text-small font-medium opacity-90">{last.detail}</p>}
          </div>
        )}

        {session.length > 0 && (
          <ul className="flex max-h-20 flex-wrap gap-1.5 overflow-y-auto" aria-label="Scanned so far">
            {session.map((s) => <li key={s.label} className="rounded-full bg-black/55 px-3 py-1 text-caption font-medium">{s.label} × {s.count}</li>)}
          </ul>
        )}

        <div className="flex gap-2">
          <button type="button" onClick={() => onSearch(null)} className="inline-flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-white/40 px-4 font-medium"><Search aria-hidden="true" className="h-4 w-4" />Search</button>
          <button type="button" onClick={finish} className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl bg-white px-4 text-body font-semibold text-ink-900">Done{added > 0 ? ` · ${added} scanned` : ''}</button>
        </div>
      </div>
    </div>
  );
};

export default BarcodeScanner;
