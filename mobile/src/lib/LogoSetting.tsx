import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { API_URL, sessionStore } from './session.ts';
import { authHeaders } from './backup.ts';
import { t } from './i18n.ts';
import { LOGO_TYPES, logoFileName, logoProblem, logoSrc } from './logo.ts';
import { Button, ErrorText, Soft, color } from './ui.tsx';

/* The business logo: choose one from the phone's photos, replace it, or remove it. It prints on tax invoices and on receipts printed from the browser. */
export default function LogoSetting({ url, onChange }: { url: string | null; onChange: (url: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const src = logoSrc(url, API_URL);

  const choose = async () => {
    setError(''); setNote('');
    try {
      const Picker = await import('expo-image-picker');
      const got = await Picker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: false });
      if (got.canceled || !got.assets?.[0]) return;
      const a = got.assets[0];
      const mime = a.mimeType ?? 'image/jpeg';
      const bad = logoProblem(mime, a.fileSize);
      if (bad) { setError(t(bad)); return; }
      setBusy(true);
      const form = new FormData();
      form.append('logo', { uri: a.uri, name: logoFileName(mime), type: LOGO_TYPES.includes(mime.toLowerCase()) ? mime : 'image/jpeg' } as never);
      const res = await fetch(`${API_URL}/api/businesses/current/logo`, { method: 'POST', headers: authHeaders(sessionStore.get()), body: form });
      const json = (await res.json().catch(() => ({}))) as { data?: { logo_url?: string }; message?: string };
      if (!res.ok || !json.data?.logo_url) { setError(json.message || t('Could not save the logo. Check the connection and try again.')); return; }
      onChange(json.data.logo_url); setNote(t('Logo saved'));
    } catch { setError(t('Could not save the logo. Check the connection and try again.')); } finally { setBusy(false); }
  };
  const remove = async () => {
    setError(''); setNote(''); setBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/businesses/current/logo`, { method: 'DELETE', headers: authHeaders(sessionStore.get()) });
      if (!res.ok) { setError(t('Could not save the logo. Check the connection and try again.')); return; }
      onChange(null); setNote(t('Logo removed'));
    } catch { setError(t('Could not save the logo. Check the connection and try again.')); } finally { setBusy(false); }
  };

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: color.soft, fontSize: 13 }}>{t('Logo')}</Text>
      {src ? <Image source={{ uri: src }} accessibilityLabel={t('Logo')} style={{ height: 64, width: 160, resizeMode: 'contain', backgroundColor: '#fff', borderRadius: 6, borderWidth: 1, borderColor: color.line }} /> : <Soft>{t('No logo yet')}</Soft>}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Button title={src ? 'Replace the logo' : 'Choose a logo'} kind="quiet" onPress={() => { void choose(); }} busy={busy} /></View>
        {src ? <View style={{ flex: 1 }}><Button title="Remove the logo" kind="danger" onPress={() => { void remove(); }} disabled={busy} /></View> : null}
      </View>
      <Soft>{t('PNG, JPEG or WebP up to 2 MB. A simple black-and-white logo prints best.')}</Soft>
      <ErrorText>{error}</ErrorText>
      {note ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok }}>{note}</Text> : null}
    </View>
  );
}
