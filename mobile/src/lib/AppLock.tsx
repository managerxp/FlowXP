import { useEffect, useRef, useState } from 'react';
import { AppState, Switch, Text, TextInput, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Button, ErrorText, Soft, color } from './ui.tsx';
import { Logo } from './Logo.tsx';
import { clearPin, loadLock, lockStore, setBio, setPin, shouldLock, tryUnlock, unlockByBio, useLock, validPin, type SecretStore } from './appLock.ts';
import { onSignOut, signOut } from './session.ts';
import { t } from './i18n.ts';

const secret = (key: string): SecretStore => ({
  get: () => SecureStore.getItemAsync(key),
  set: (v) => SecureStore.setItemAsync(key, v),
  clear: () => SecureStore.deleteItemAsync(key)
});
const store = secret('app_lock_pin');
const bioStore = secret('app_lock_bio');
onSignOut(() => clearPin(store, bioStore));   // signing out is the way back in after a forgotten PIN

/* The phone's fingerprint / face check. Loaded only when used: an app build made before this module was added has no such native part,
   and then the PIN simply stays the only way in. */
const bioAvailable = async (): Promise<boolean> => {
  try {
    const LA = await import('expo-local-authentication');
    return (await LA.hasHardwareAsync()) && (await LA.isEnrolledAsync());
  } catch { return false; }
};
const askBio = async (): Promise<boolean> => {
  try {
    const LA = await import('expo-local-authentication');
    const r = await LA.authenticateAsync({ promptMessage: t('Open FlowXP'), cancelLabel: t('Use PIN'), disableDeviceFallback: true });
    return r.success;
  } catch { return false; }
};

const pinInput = { borderWidth: 1, borderColor: color.line, borderRadius: 10, padding: 12, fontSize: 24, letterSpacing: 12, textAlign: 'center' as const, minWidth: 160, color: color.ink };

/** Mounted once at the top of the app: loads the PIN, locks again after the app has been away, and covers everything while locked. */
export function AppLockGate() {
  const { locked, pin, bio } = useLock();
  const left = useRef<number | null>(null);
  const [entered, setEntered] = useState('');
  const [wrong, setWrong] = useState(false);
  useEffect(() => { void loadLock(store, bioStore); }, []);
  // each time the lock comes up, ask for the fingerprint / face once; cancelling it leaves the PIN box
  const tryBio = () => { void askBio().then((ok) => { if (ok) unlockByBio(); }); };
  useEffect(() => { if (locked && pin && bio) tryBio(); }, [locked, pin, bio]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        if (shouldLock(lockStore.get().pin != null, left.current, Date.now())) lockStore.set({ locked: true });
        left.current = null;
      } else if (left.current == null) left.current = Date.now();
    });
    return () => sub.remove();
  }, []);
  if (!locked || !pin) return null;
  const change = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 4);
    setEntered(d); setWrong(false);
    if (d.length === 4 && !tryUnlock(d)) { setWrong(true); setEntered(''); } else if (d.length === 4) setEntered('');
  };
  return (
    <View accessibilityViewIsModal style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 }}>
      <Logo width={140} />
      <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: '700', color: color.ink }}>{t('Enter your PIN')}</Text>
      <TextInput accessibilityLabel={t('PIN')} value={entered} onChangeText={change} keyboardType="number-pad" secureTextEntry maxLength={4} autoFocus style={pinInput} />
      <ErrorText>{wrong ? t('That PIN is not right') : ''}</ErrorText>
      {bio ? <Button title={t('Use fingerprint or face')} kind="quiet" onPress={tryBio} /> : null}
      <Button title={t('Forgot PIN? Sign out')} kind="quiet" onPress={() => { void signOut(); }} />
    </View>
  );
}

/** Settings > App lock: turn the PIN on, change it, or turn it off. */
export default function AppLockSettings() {
  const { pin, bio } = useLock();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [canBio, setCanBio] = useState(false);
  useEffect(() => { void bioAvailable().then(setCanBio); }, []);
  // switching it on asks for the finger / face first, so it is known to work before the app relies on it
  const toggleBio = async (on: boolean) => {
    if (on && !(await askBio())) return;
    await setBio(bioStore, on);
  };
  const save = async () => {
    if (!validPin(value)) { setError(t('Enter 4 digits')); return; }
    await setPin(store, value); setOpen(false); setValue(''); setError('');
  };
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontWeight: '700', color: color.ink }}>{t('App lock')}</Text>
      <Soft>{t('Ask for a 4-digit PIN when the app opens or when you come back after a while. The PIN stays on this phone.')}</Soft>
      {open ? (
        <>
          <TextInput accessibilityLabel={t('New PIN')} value={value} onChangeText={(v) => setValue(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" secureTextEntry maxLength={4} style={pinInput} />
          <ErrorText>{error}</ErrorText>
          <Button title={t('Save PIN')} onPress={() => { void save(); }} />
          <Button title={t('Cancel')} kind="quiet" onPress={() => { setOpen(false); setValue(''); setError(''); }} />
        </>
      ) : (
        <>
          <Button title={pin ? t('Change PIN') : t('Turn on App lock')} kind="quiet" onPress={() => setOpen(true)} />
          {pin && canBio ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
              <Text style={{ color: color.ink, flex: 1 }}>{t('Open with fingerprint or face')}</Text>
              <Switch accessibilityLabel={t('Open with fingerprint or face')} value={bio} onValueChange={(v) => { void toggleBio(v); }} />
            </View>
          ) : null}
          {pin ? <Button title={t('Turn off App lock')} kind="quiet" onPress={() => { void clearPin(store, bioStore); }} /> : null}
        </>
      )}
    </View>
  );
}
