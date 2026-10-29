import { argon2, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const argon2Async = promisify(argon2);
// OWASP's minimum Argon2id profile: 19 MiB, 2 passes, 1 lane
const PARAMS = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 };

export const hashPassword = async (password: string): Promise<string> => {
  const nonce = randomBytes(16);
  const tag = await argon2Async('argon2id', { message: password, nonce, ...PARAMS });
  return `argon2id$${PARAMS.memory},${PARAMS.passes},${PARAMS.parallelism}$${nonce.toString('base64url')}$${tag.toString('base64url')}`;
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const [alg, params, salt, tag] = stored.split('$');
  if (alg !== 'argon2id' || !params || !salt || !tag) return false;
  const [memory, passes, parallelism] = params.split(',').map(Number) as [number, number, number];
  const expected = Buffer.from(tag, 'base64url');
  const actual = await argon2Async('argon2id', { message: password, nonce: Buffer.from(salt, 'base64url'), memory, passes, parallelism, tagLength: expected.length });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

/** A session token is 32 random bytes; only its SHA-256 is stored, so a database leak does not hand out sessions. */
export const newToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** A stand-in hash to verify against when the email is unknown, so "no such user" and "wrong password" take the same time. */
export const DUMMY_HASH = await hashPassword('flowbook-dummy-password');

export const passwordProblem = (password: string): string | null =>
  password.length < 10 ? 'use at least 10 characters' : password.length > 200 ? 'that password is too long' : null;
