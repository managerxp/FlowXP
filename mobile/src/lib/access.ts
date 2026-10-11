import type { Business } from './session.ts';

/** Can this person do any of these things? It reads what the server says they can actually do (their role, with their own changes applied).
    A phone that has not heard that yet (an older sign-in) does not shut anyone out: the server still decides. */
export const allowed = (business: Pick<Business, 'effective_permissions'> | null | undefined, ...keys: string[]): boolean => {
  const p = business?.effective_permissions;
  if (!p || Object.keys(p).length === 0) return true;
  return keys.some((k) => p[k] === true);
};
