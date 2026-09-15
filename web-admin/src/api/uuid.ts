/**
 * A v4 UUID that works off HTTPS.
 *
 * `crypto.randomUUID()` is only defined in a secure context, which means HTTPS
 * or localhost. A phone opening this app at `http://192.168.1.196:5178` gets
 * neither, so calling it throws and every write carrying an Idempotency-Key
 * fails. `crypto.getRandomValues` has no such restriction, so build the UUID
 * from it and keep a last-resort path for browsers that block even that.
 */
export function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);

  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
