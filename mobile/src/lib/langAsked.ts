import { kvGet, kvSet } from './local.ts';
import { normaliseLang } from './langrules.ts';

/* The language is asked once per person on a phone, right after they first sign in, and not before. Plain functions over the phone's key-value store. */
const key = (userId: number) => `language_asked_${userId}`;

/** Whether to show the "Choose your language" screen: this person has no language saved on their account and has not been asked on this phone. */
export const needsLanguageAsk = async (user: { user_id: number; language?: string | null }): Promise<boolean> => {
  if (normaliseLang(user.language)) return false;   // they chose one already, here or on another device
  return (await kvGet(key(user.user_id)).catch(() => null)) !== '1';
};

export const markLanguageAsked = (userId: number): Promise<void> => kvSet(key(userId), '1').catch(() => {});
