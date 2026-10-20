/*
 * The languages FlowXP can show. This is the one list the server trusts: a person's language, a business's default
 * language and anything the apps send are checked against it. Adding a language = add its code here, add its
 * resources to the web (frontend/src/i18n/locales/<code>) and the phone (mobile/src/lib/i18n.ts), and the apps
 * offer it. Language is display text only: it never changes currency, timezone, tax or any stored amount.
 */
export const LOCALES = ['en', 'hi', 'ml', 'ta', 'bn', 'te', 'kn'];

/** The language code if it is one we support, else null. Accepts "hi", "hi-IN", "HI". */
export const cleanLocale = (value) => {
  if (value == null || value === '') return null;
  const base = String(value).trim().toLowerCase().split(/[-_]/)[0];
  return LOCALES.includes(base) ? base : null;
};
