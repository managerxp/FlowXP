import { useState } from 'react';
import { Image, View } from 'react-native';
import { API_URL, sessionStore } from './session.ts';
import { authHeaders } from './backup.ts';
import { LOGO_TYPES, logoFileName, logoSrc } from './logo.ts';
import { Button, ErrorText, Soft, color } from './ui.tsx';

/* A product's photo: shown, and chosen from the phone's photos (or taken with the camera) and sent to the same place as the website's photo. */
export default function ProductPhoto({ productId, url, onChange }: { productId: number; url: string | null | undefined; onChange: (url: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const src = logoSrc(url, API_URL);

  const send = async (from: 'library' | 'camera') => {
    setError('');
    try {
      const Picker = await import('expo-image-picker');
      const opts = { mediaTypes: ['images' as const], quality: 0.6, allowsEditing: true, aspect: [4, 3] as [number, number] };
      if (from === 'camera') { const ok = await Picker.requestCameraPermissionsAsync(); if (!ok.granted) { setError('Allow the camera to take a photo, or choose one from your photos.'); return; } }
      const got = from === 'camera' ? await Picker.launchCameraAsync(opts) : await Picker.launchImageLibraryAsync(opts);
      if (got.canceled || !got.assets?.[0]) return;
      const a = got.assets[0];
      const mime = (a.mimeType ?? 'image/jpeg').toLowerCase();
      if (!LOGO_TYPES.includes(mime)) { setError('The photo must be a PNG, JPEG or WebP image'); return; }
      if (a.fileSize != null && a.fileSize > 5 * 1024 * 1024) { setError('The photo must be 5 MB or smaller'); return; }
      setBusy(true);
      const form = new FormData();
      form.append('image', { uri: a.uri, name: logoFileName(mime).replace('logo', 'photo'), type: mime } as never);
      const res = await fetch(`${API_URL}/api/products/${productId}/image`, { method: 'POST', headers: authHeaders(sessionStore.get()), body: form });
      const json = (await res.json().catch(() => ({}))) as { data?: { image_url?: string }; message?: string };
      if (!res.ok || !json.data?.image_url) { setError(json.message || 'Could not save the photo. Check the connection and try again.'); return; }
      onChange(json.data.image_url);
    } catch { setError('Could not save the photo. Check the connection and try again.'); } finally { setBusy(false); }
  };

  return (
    <View style={{ gap: 8 }}>
      {src
        ? <Image source={{ uri: src }} accessibilityLabel="Product photo" style={{ height: 180, borderRadius: 12, backgroundColor: color.wash }} resizeMode="cover" />
        : <View style={{ height: 120, borderRadius: 12, backgroundColor: color.wash, alignItems: 'center', justifyContent: 'center' }}><Soft>No photo yet</Soft></View>}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Button title={src ? 'Change photo' : 'Add a photo'} kind="quiet" onPress={() => { void send('library'); }} busy={busy} /></View>
        <View style={{ flex: 1 }}><Button title="Take a photo" kind="quiet" onPress={() => { void send('camera'); }} disabled={busy} /></View>
      </View>
      <ErrorText>{error}</ErrorText>
    </View>
  );
}
