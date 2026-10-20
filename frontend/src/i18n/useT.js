/*
 * Translation for screen text. The key IS the English text, so a screen reads normally in the source and a text nobody has translated
 * yet simply shows in English (never a code). Use it in a component:   const tr = useT();   ...   <Button>{tr('Save changes')}</Button>
 * Values go in double braces, passed as the second argument: tr(text, { n: 3 })
 * Texts live in locales/<code>/screens.json. scripts/i18n-extract.mjs converts a screen to this form and adds its English texts.
 * The shared, structured texts (menu, sign-in, site header/footer) are in the other namespaces and use useTranslation directly.
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

const OPTS = { ns: 'screens', keySeparator: false, nsSeparator: false };

/** Marks a text that is written once and shown later through tr(): T around a text returns it unchanged, but marks it as a translation key the tests and tools can find. */
export const T = (text) => text;

export const useT = () => {
  const { t } = useTranslation('screens');
  // anything that is not a plain text (a value that turned out to be markup, a number) is shown as it is
  return useCallback((text, vars) => (typeof text === 'string' ? t(text, { ...OPTS, defaultValue: text, ...vars }) : text), [t]);
};
