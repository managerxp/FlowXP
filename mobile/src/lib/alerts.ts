/* Phone alerts: the small decisions, kept apart from the phone's notification service so they can be tested. (The part that talks to the phone is push.ts.) */

/** Screens an alert may open. The server names one in the alert; anything else is ignored, so an alert can never send the app somewhere it does not expect. */
const SCREENS = ['/kitchen', '/tables', '/appointments', '/stock', '/home'] as const;
export type AlertScreen = (typeof SCREENS)[number];

/** Where tapping an alert goes. The alert's own screen if it is one we know; else by what it was about; else nowhere. */
export const screenFor = (data: unknown): AlertScreen | null => {
  const d = (data && typeof data === 'object' ? data : {}) as { route?: unknown; category?: unknown };
  if (typeof d.route === 'string' && (SCREENS as readonly string[]).includes(d.route)) return d.route as AlertScreen;
  switch (d.category) {
    case 'stock': return '/stock';
    case 'kitchen': return '/kitchen';
    case 'orders': case 'ready': case 'integrations': return '/tables';
    case 'bookings': return '/appointments';
    default: return null;
  }
};

/** Kept on the phone: '1' = alerts on, '0' = the person switched them off. Nothing kept means we have not asked yet. */
export type AlertChoice = 'on' | 'off' | 'unasked';
export const choiceOf = (kept: string | null): AlertChoice => (kept === '1' ? 'on' : kept === '0' ? 'off' : 'unasked');

/** What to do when the app opens and someone is signed in. */
export type Step = 'register' | 'ask' | 'nothing';
export const nextStep = (choice: AlertChoice, permission: 'granted' | 'denied' | 'undetermined', asked: boolean): Step => {
  if (choice === 'off') return 'nothing';
  if (permission === 'granted') return 'register';          // keep the server's address for this phone current
  if (permission === 'denied') return 'nothing';            // the phone's own settings must change it; asking again would only annoy
  return asked ? 'nothing' : 'ask';                          // ask once, in our own words, before the phone's box
};

/** The Expo project the phone's address belongs to. Without it (an unbuilt project) there are no phone alerts, and that is not an error. */
export const projectIdOf = (config: { extra?: { eas?: { projectId?: unknown } } } | null | undefined, eas?: { projectId?: unknown } | null): string | null => {
  const id = config?.extra?.eas?.projectId ?? eas?.projectId;
  return typeof id === 'string' && id.length > 0 ? id : null;
};
