import { useState } from 'react';
import { Image, Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { API_URL, sessionStore } from './session.ts';
import { authHeaders } from './backup.ts';
import { logoSrc } from './logo.ts';
import { t } from './i18n.ts';
import { filePart } from './filePart.ts';
import { Button, ErrorText, color } from './ui.tsx';

export type Picked = { uri: string; mime: string };
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Choose a photo from the phone's photos or take one. Returns the picture, null when cancelled, or a message to show. */
export const pickMemberPhoto = async (from: 'library' | 'camera'): Promise<Picked | null | { error: string }> => {
  try {
    const Picker = await import('expo-image-picker');
    const opts = { mediaTypes: ['images' as const], quality: 0.6, allowsEditing: true, aspect: [1, 1] as [number, number] };
    if (from === 'camera') { const ok = await Picker.requestCameraPermissionsAsync(); if (!ok.granted) return { error: t('Allow the camera to take a photo, or choose one from your photos.') }; }
    const got = from === 'camera' ? await Picker.launchCameraAsync(opts) : await Picker.launchImageLibraryAsync(opts);
    if (got.canceled || !got.assets?.[0]) return null;
    const a = got.assets[0];
    // The phone may call a JPEG "image/jpg", leave the type out, or hand back a HEIC original; an edited/re-encoded picture is a JPEG unless its file says PNG or WebP.
    const ext = (a.uri.split('?')[0]!.split('.').pop() ?? '').toLowerCase();
    const mime = ext === 'png' || a.mimeType === 'image/png' ? 'image/png' : ext === 'webp' || a.mimeType === 'image/webp' ? 'image/webp' : 'image/jpeg';
    if (a.fileSize != null && a.fileSize > 5 * 1024 * 1024) return { error: t('The photo must be 5 MB or smaller') };
    return { uri: a.uri, mime };
  } catch { return { error: t('Could not open the photos. Check the permission and try again.') }; }
};

/** Send the picture to the member's profile; returns the saved address. */
export const uploadMemberPhoto = async (memberId: number | string, pic: Picked): Promise<string> => {
  const form = new FormData();
  form.append('image', await filePart(pic.uri));
  const res = await fetch(`${API_URL}/api/gym/members/${memberId}/photo`, { method: 'POST', headers: authHeaders(sessionStore.get()), body: form });
  const json = (await res.json().catch(() => ({}))) as { data?: { photo_url?: string }; message?: string };
  if (!res.ok || !json.data?.photo_url) throw new Error(json.message || t('Could not save the photo. Check the connection and try again.'));
  return json.data.photo_url;
};

/** A round photo (or the first letters of the name), shown large with the choices to change it. */
export const Avatar = ({ name, url, size = 72 }: { name: string; url?: string | null; size?: number }) => {
  const src = logoSrc(url, API_URL);
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  return src
    ? <Image source={{ uri: src }} accessibilityLabel={name} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color.wash }} />
    : <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color.navy, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: color.onNavy, fontWeight: '700', fontSize: size * 0.36 }}>{letters}</Text></View>;
};

/** On a saved member: the photo with Change photo / Take a photo, saved at once. */
export default function MemberPhoto({ memberId, name, url, onChange }: { memberId: number | string; name: string; url?: string | null; onChange: (url: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [big, setBig] = useState(false);
  const { width } = useWindowDimensions();
  const send = async (from: 'library' | 'camera') => {
    setError('');
    const pic = await pickMemberPhoto(from);
    if (!pic) return;
    if ('error' in pic) { setError(pic.error); return; }
    setBusy(true);
    try { onChange(await uploadMemberPhoto(memberId, pic)); } catch (e) { setError(e instanceof Error ? e.message : t('Could not save the photo. Check the connection and try again.')); } finally { setBusy(false); }
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Enlarge the photo')} onPress={() => setBig(true)} disabled={!url}><Avatar name={name} url={url} size={72} /></Pressable>
        <View style={{ flex: 1, gap: 8 }}>
          <Button title={url ? 'Change photo' : 'Add a photo'} kind="quiet" onPress={() => { void send('library'); }} busy={busy} style={{ minHeight: 44 }} />
          <Button title="Take a photo" kind="quiet" onPress={() => { void send('camera'); }} disabled={busy} style={{ minHeight: 44 }} />
        </View>
      </View>
      <ErrorText>{error}</ErrorText>
      <Modal visible={big} transparent animationType="fade" onRequestClose={() => setBig(false)}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} onPress={() => setBig(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' }}>
          <Avatar name={name} url={url} size={Math.min(width - 32, 520)} />
          <Text style={{ color: '#fff', marginTop: 16, fontWeight: '600' }}>{name}</Text>
        </Pressable>
      </Modal>
    </View>
  );
}
