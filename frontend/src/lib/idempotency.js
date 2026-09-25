/*
 * One Idempotency-Key per user action, reused if the same action is retried.
 * The server answers a repeated key with the first response instead of writing
 * a second invoice/payment/order (see backend middleware/idempotency.js).
 *
 * Not derived from the request body: two identical sales a minute apart are
 * two sales. The key belongs to the submission, not to what it contains.
 */
import { useRef } from 'react';

export const useIdempotencyKey = () => {
  const ref = useRef(null);
  return {
    get: () => (ref.current ??= crypto.randomUUID()),
    // A network failure (fetch's TypeError) may have reached the server, so keep
    // the key for the retry. Any other outcome is a definite answer: start fresh.
    settle: (error) => { if (!(error instanceof TypeError)) ref.current = null; }
  };
};
