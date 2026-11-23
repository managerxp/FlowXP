import { useState } from 'react';
import { filePart } from './filePart.ts';
import { API_URL, sessionStore } from './session.ts';
import { authHeaders } from './backup.ts';
import { t } from './i18n.ts';
import { Button, ErrorText, Soft } from './ui.tsx';

export type PlateRead = { plate: string; make?: string | null; colour?: string | null };
type Reply = { data?: { plate?: string | null; confidence?: 'high' | 'medium' | 'low' | null; problem?: string | null; make?: string | null; colour?: string | null }; message?: string };

/** Why a photo could not be read, in words that tell the person what to do next. Pure, so it can be tested. */
export const plateProblem = (problem?: string | null): string => {
  switch (problem) {
    case 'too_blurry': return 'The photo is blurry. Hold the phone steady and try again.';
    case 'too_dark': return 'It is too dark to read. Use the flash or move into the light, then try again.';
    case 'too_far': return 'The plate is too small in the photo. Stand about a metre away so it fills the frame.';
    case 'glare': return 'There is glare on the plate. Tilt the phone a little and try again.';
    case 'cut_off': return 'Part of the plate is cut off. Keep the whole plate in the photo.';
    default: return 'No number plate found in that photo. Point the camera at the plate and try again.';
  }
};

/* Take a photo of the number plate and the number fills in (with the vehicle's make when it is clear). The photo is deleted from the phone as soon as it has been read (and the server never keeps it). The person can still correct the number. */
export default function PlateScan({ onPlate }: { onPlate: (plate: string, read: PlateRead) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [check, setCheck] = useState('');
  const go = async () => {
    setError(''); setCheck('');
    let uri = '';
    try {
      const Picker = await import('expo-image-picker');
      const perm = await Picker.requestCameraPermissionsAsync();
      if (!perm.granted) { setError(t('Allow the camera to read a number plate, or type the number.')); return; }
      // a sharper photo than before (the plate is small in the frame), and the person can crop to the plate
      const got = await Picker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: true });
      if (got.canceled || !got.assets?.[0]) return;
      const a = got.assets[0]; uri = a.uri; setBusy(true);
      const form = new FormData();
      form.append('image', await filePart(uri));
      const res = await fetch(`${API_URL}/api/autoparts/jobcards/plate-scan`, { method: 'POST', headers: authHeaders(sessionStore.get()), body: form });
      const json = (await res.json().catch(() => ({}))) as Reply;
      if (!res.ok) { setError(json.message ? t(json.message) : t('Could not reach the reader. Check the internet, or type the number.')); return; }
      const d = json.data;
      if (!d?.plate) { setError(t(plateProblem(d?.problem))); return; }
      if (d.confidence && d.confidence !== 'high') setCheck(t('Please check the number: a few characters were hard to read.'));
      onPlate(d.plate, { plate: d.plate, make: d.make ?? null, colour: d.colour ?? null });
    } catch { setError(t('Could not reach the reader. Check the internet, or type the number.')); } finally {
      setBusy(false);
      if (uri) { try { const FS = await import('expo-file-system'); await new FS.File(uri).delete(); } catch { /* the cache is cleared by the phone anyway */ } }
    }
  };
  return <><Button title="Scan the number plate" kind="quiet" onPress={() => { void go(); }} busy={busy} /><ErrorText>{error}</ErrorText>{check ? <Soft>{check}</Soft> : null}</>;
}
