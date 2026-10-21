/*
 * Where the Android app can be downloaded. Set VITE_ANDROID_APP_URL when building the site (a link to the signed APK, for example https://flowxp.in/downloads/flowxp.apk,
 * or the Google Play page once the app is listed). Left empty, the site shows no download button: a button to a file that is not there is worse than none.
 */
const clean = (v) => { try { const u = new URL(String(v || '').trim()); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };

export const ANDROID_APP_URL = clean(import.meta.env.VITE_ANDROID_APP_URL);
export const ANDROID_IS_PLAY = /play\.google\.com/.test(ANDROID_APP_URL);
