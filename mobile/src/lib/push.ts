import { Alert, Platform } from 'react-native';
import * as Device from 'expo-device';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { router } from 'expo-router';
import { api, onSignOut, sessionStore } from './session.ts';
import { kvGet, kvSet } from './local.ts';
import { choiceOf, nextStep, projectIdOf, screenFor, type AlertChoice } from './alerts.ts';
import { t } from './i18n.ts';

/* Alerts on this phone: a new order for the kitchen, a dish ready for the waiter, stock running out. The server sends them (through Expo); this file asks the phone's
   permission, tells the server where to send, and opens the right screen when one is tapped. Everything here is allowed to fail quietly: no alert is worth a crash,
   and the app works exactly as before without them.

   Expo Go cannot do alerts (Android: expo-notifications even refuses to be loaded there, which would stop the whole app starting), so the library is only loaded
   in a real build; in Expo Go every function here is a quiet no-op. */

type Notifications = typeof import('expo-notifications');
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
let loaded: Notifications | null | undefined;
const library = (): Notifications | null => {
  if (loaded !== undefined) return loaded;
  try { loaded = inExpoGo ? null : (require('expo-notifications') as Notifications); } catch { loaded = null; }
  return loaded;
};

const CHOICE = 'alerts_choice';   // '1' on, '0' off, nothing = not asked
const ASKED = 'alerts_asked';
const TOKEN = 'alerts_token';     // the address last given to the server, so it can be taken back on sign-out

export const readChoice = async (): Promise<AlertChoice> => choiceOf(await kvGet(CHOICE).catch(() => null));

const projectId = () => projectIdOf(Constants.expoConfig as never, Constants.easConfig as never);

/** Ring and pop up for orders and ready dishes ("alerts"); everything else is quiet ("default"). Created every time: it is cheap, and a phone that lost them gets them back. */
const makeChannels = async (N: Notifications) => {
  if (Platform.OS !== 'android') return;
  await N.setNotificationChannelAsync('alerts', { name: t('Orders and ready dishes'), importance: N.AndroidImportance.HIGH, vibrationPattern: [0, 300, 200, 300], sound: 'default' });
  await N.setNotificationChannelAsync('default', { name: t('Other alerts'), importance: N.AndroidImportance.DEFAULT });
};

/** This phone's address for alerts, or null if it cannot have one (an emulator, no project id, no permission, the phone's service unreachable). */
const phoneAddress = async (N: Notifications): Promise<string | null> => {
  const id = projectId();
  if (!id || !Device.isDevice) return null;
  try { return (await N.getExpoPushTokenAsync({ projectId: id })).data; } catch { return null; }
};

/** Tell the server where to send this person's alerts. Quiet on failure; it is tried again the next time the app opens. */
const register = async (N: Notifications): Promise<boolean> => {
  const address = await phoneAddress(N);
  if (!address || !sessionStore.get().token) return false;
  try {
    await api.post('/notifications/devices', { token: address, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
    await kvSet(TOKEN, address).catch(() => {});
    return true;
  } catch { return false; }
};

/** Take this phone off the server's list (on sign-out, or when the person switches alerts off). */
export const unregister = async () => {
  const address = await kvGet(TOKEN).catch(() => null);
  if (!address) return;
  try { await api.call('/notifications/devices', { method: 'DELETE', body: { token: address } }); await kvSet(TOKEN, '').catch(() => {}); } catch { /* it is removed the next time the server hears from this phone's alerts failing */ }
};

/** Switch alerts on: ask the phone's permission if needed, then register. Returns what happened, for the Settings screen to say. */
export const turnOn = async (): Promise<'on' | 'blocked' | 'unavailable'> => {
  const N = library();
  if (!N) return 'unavailable';
  try {
    await makeChannels(N);
    let permission = await N.getPermissionsAsync();
    if (permission.status !== 'granted' && permission.canAskAgain) permission = await N.requestPermissionsAsync();
    if (permission.status !== 'granted') return 'blocked';
    await kvSet(CHOICE, '1').catch(() => {});
    return (await register(N)) ? 'on' : 'unavailable';
  } catch { return 'unavailable'; }
};

export const turnOff = async () => { await kvSet(CHOICE, '0').catch(() => {}); await unregister(); };

/** Once, after the first sign-in, in our own words and before the phone's own box. */
const askOnce = () => new Promise<void>((done) => {
  void kvSet(ASKED, '1').catch(() => {});
  Alert.alert(
    t('Get alerts on this phone?'),
    t('FlowXP can tell you when a guest sends an order, when a dish is ready for your table, or when stock is running out. You can change this in Settings.'),
    [{ text: t('Not now'), style: 'cancel', onPress: () => { void kvSet(CHOICE, '0').catch(() => {}); done(); } }, { text: t('Turn on'), onPress: () => { void turnOn().finally(done); } }],
    { cancelable: false }
  );
});

/** Whenever someone is signed in and the app is open: keep this phone registered, or ask once. */
export const syncAlerts = async () => {
  const N = library();
  if (!N || !sessionStore.get().token) return;
  try {
    await makeChannels(N);
    const permission = (await N.getPermissionsAsync()).status;
    const step = nextStep(await readChoice(), permission === 'granted' ? 'granted' : permission === 'denied' ? 'denied' : 'undetermined', (await kvGet(ASKED).catch(() => null)) === '1');
    if (step === 'register') await register(N);
    else if (step === 'ask') await askOnce();
  } catch { /* alerts are optional */ }
};

let installed = false;
/** Call once when the app starts: show alerts while the app is open, and open the right screen when one is tapped. */
export const installAlerts = () => {
  const N = library();
  if (installed || !N) return;
  installed = true;
  try {
    N.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
    const open = (data: unknown) => { const screen = screenFor(data); if (screen && sessionStore.get().token) router.navigate(screen as never); };
    N.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data));
    // the app was closed and an alert opened it
    void N.getLastNotificationResponseAsync().then((r) => { if (r) setTimeout(() => open(r.notification.request.content.data), 800); }).catch(() => {});
    onSignOut(unregister);
  } catch { /* alerts are optional */ }
};
