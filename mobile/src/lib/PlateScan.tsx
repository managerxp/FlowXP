import { useState } from 'react';
import { API_URL, sessionStore } from './session.ts';
import { authHeaders } from './backup.ts';
import { t } from './i18n.ts';
import { Button, ErrorText } from './ui.tsx';

/* Take a photo of the number plate and the number fills in. The photo is deleted from the phone as soon as it has been read (and the server never keeps it). The person can still correct the number. */
export default function PlateScan({ onPlate }: { onPlate: (plate: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setError('');
    let uri = '';
    try {
      const Picker = await import('expo-image-picker');
      const perm = await Picker.requestCameraPermissionsAsync();
      if (!perm.granted) { setError(t('Allow the camera to read a number plate, or type the number.')); return; }
      const got = await Picker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.5, allowsEditing: false });
      if (got.canceled || !got.assets?.[0]) return;
      const a = got.assets[0]; uri = a.uri; setBusy(true);
      const form = new FormData();
      form.append('image', { uri, name: 'plate.jpg', type: a.mimeType ?? 'image/jpeg' } as never);
      const res = await fetch(`${API_URL}/api/autoparts/jobcards/plate-scan`, { method: 'POST', headers: authHeaders(sessionStore.get()), body: form });
      const json = (await res.json().catch(() => ({}))) as { data?: { plate?: string | null }; message?: string };
      if (!res.ok) { setError(json.message || t('Could not read the plate. Type the number.')); return; }
      if (!json.data?.plate) { setError(t('Could not read a plate in that photo. Try again closer, or type the number.')); return; }
      onPlate(json.data.plate);
    } catch { setError(t('Could not read the plate. Type the number.')); } finally {
      setBusy(false);
      if (uri) { try { const FS = await import('expo-file-system'); await new FS.File(uri).delete(); } catch { /* the cache is cleared by the phone anyway */ } }
    }
  };
  return <><Button title="Scan the number plate" kind="quiet" onPress={() => { void go(); }} busy={busy} /><ErrorText>{error}</ErrorText></>;
}
