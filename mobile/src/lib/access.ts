import type { Business } from './session.ts';

/** Does the business's plan include this feature? Missing = on, like the server (an explicit false turns it off); the server still refuses what the plan lacks. */
export const hasFeature = (business: Pick<Business, 'subscription'> | null | undefined, key: string): boolean => business?.subscription?.feature_flags?.[key] !== false;

/** Can this person do any of these things? It reads what the server says they can actually do (their role, with their own changes applied).
    A phone that has not heard that yet (an older sign-in) does not shut anyone out: the server still decides. */
export const allowed = (business: Pick<Business, 'effective_permissions'> | null | undefined, ...keys: string[]): boolean => {
  const p = business?.effective_permissions;
  if (!p || Object.keys(p).length === 0) return true;
  return keys.some((k) => p[k] === true);
};
